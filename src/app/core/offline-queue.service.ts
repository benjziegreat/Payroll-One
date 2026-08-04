import { Injectable, computed, signal } from '@angular/core';
import {
  AttendanceService,
  type AttendanceAction,
  type BiometricMethod,
} from './attendance.service';
import type { Coordinates } from './geo.service';
import { UnauthorizedError } from './local-api.service';
import { SelfieService } from './selfie.service';

const DB_NAME = 'payroll_one_offline';
const DB_VERSION = 1;
const STORE_NAME = 'pending_attendance';
const RETRY_INTERVAL_MS = 15000;
const FORCED_OFFLINE_KEY = 'payroll_one_forced_offline';

export interface PendingAttendanceEntry {
  clientEventId: string;
  userId: string;
  action: AttendanceAction;
  method: BiometricMethod;
  latitude?: number;
  longitude?: number;
  occurredAt: string;
  officeLocationId?: number;
  /** A recorded video selfie still waiting to be attached — see SelfieService. Stored directly in IndexedDB (Blobs are structured-clone-safe in modern browsers). */
  selfieBlob?: Blob;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'clientEventId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, mode);
        const request = fn(tx.objectStore(STORE_NAME));
        tx.oncomplete = () => resolve(request.result);
        tx.onerror = () => reject(tx.error ?? request.error);
      }),
  );
}

/**
 * Queues clock in/out events in IndexedDB when they can't reach the server
 * right away, and flushes them automatically once connectivity is back.
 * Runs in the page (not inside the service worker) so it works the same way
 * in every browser — the Background Sync API that would let this fire even
 * with the tab closed is Chromium-only (no Safari/iOS, no Firefox support),
 * so it isn't a reliable primary mechanism for this app's actual device mix.
 */
@Injectable({ providedIn: 'root' })
export class OfflineQueueService {
  readonly isOnline = signal(navigator.onLine);
  /** Manual "work offline" override — independent of actual connectivity. */
  readonly forcedOffline = signal(localStorage.getItem(FORCED_OFFLINE_KEY) === '1');
  /** What the app actually does: send immediately, or queue. */
  readonly effectiveOnline = computed(() => this.isOnline() && !this.forcedOffline());

  readonly pendingCount = signal(0);
  readonly syncing = signal(false);
  /** The server rejected a sync as unauthenticated (expired/missing session) — retrying won't help until the user confirms their identity online again. Cleared by clearNeedsReauth() once they do. */
  readonly needsReauth = signal(false);

  private flushing = false;

  constructor(
    private readonly attendanceService: AttendanceService,
    private readonly selfieService: SelfieService,
  ) {
    window.addEventListener('online', () => {
      this.isOnline.set(true);
      if (this.effectiveOnline()) this.flush();
    });
    window.addEventListener('offline', () => this.isOnline.set(false));

    this.refreshPendingCount();
    if (this.effectiveOnline()) this.flush();
    setInterval(() => {
      if (this.effectiveOnline()) this.flush();
    }, RETRY_INTERVAL_MS);
  }

  /** Manually toggle "work offline" — queues everything until switched back. */
  setForcedOffline(forced: boolean) {
    this.forcedOffline.set(forced);
    localStorage.setItem(FORCED_OFFLINE_KEY, forced ? '1' : '0');
    if (!forced && this.isOnline()) this.flush();
  }

  /** Try to send immediately; if that fails for any reason, queue it for later. */
  async logOrQueue(
    userId: string,
    action: AttendanceAction,
    method: BiometricMethod,
    position: Coordinates | undefined,
    occurredAt: string,
    clientEventId: string,
    officeLocationId?: number,
    selfieBlob?: Blob | null,
  ): Promise<{ queued: boolean }> {
    if (this.effectiveOnline()) {
      try {
        await this.attendanceService.logEvent(userId, action, method, position, {
          occurredAt,
          clientEventId,
          officeLocationId,
        });
        if (selfieBlob) {
          try {
            await this.selfieService.uploadForAttendance(clientEventId, selfieBlob);
          } catch {
            // The clock-in/out itself already succeeded — only the video
            // upload failed (e.g. connection dropped mid-upload). Queue just
            // the retry rather than losing the recorded selfie; the
            // attendance insert is idempotent by clientEventId so replaying
            // it during flush() is harmless.
            await this.enqueue({
              clientEventId,
              userId,
              action,
              method,
              latitude: position?.latitude,
              longitude: position?.longitude,
              occurredAt,
              officeLocationId,
              selfieBlob,
            });
          }
        }
        return { queued: false };
      } catch {
        // Could be a real server rejection (e.g. out of range) or just a
        // dropped connection — either way, keep it safe by queuing it rather
        // than losing the clock-in/out the user just confirmed biometrically.
      }
    }

    await this.enqueue({
      clientEventId,
      userId,
      action,
      method,
      latitude: position?.latitude,
      longitude: position?.longitude,
      occurredAt,
      officeLocationId,
      selfieBlob: selfieBlob ?? undefined,
    });
    return { queued: true };
  }

  private async enqueue(entry: PendingAttendanceEntry) {
    await withStore('readwrite', (store) => store.put(entry));
    await this.refreshPendingCount();
  }

  /** Call after the user confirms their identity online again (a fresh sign-in) — clears the stuck state and immediately retries whatever's still queued. */
  clearNeedsReauth() {
    this.needsReauth.set(false);
    this.flush();
  }

  async flush() {
    // Retrying wouldn't help — same expired/missing token, same rejection —
    // so don't hammer the server until the user actually re-authenticates.
    if (this.flushing || this.forcedOffline() || this.needsReauth()) return;
    this.flushing = true;
    this.syncing.set(true);
    try {
      const entries = await withStore<PendingAttendanceEntry[]>('readonly', (store) =>
        store.getAll(),
      );
      entries.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));

      for (const entry of entries) {
        try {
          await this.attendanceService.logEvent(
            entry.userId,
            entry.action,
            entry.method,
            entry.latitude !== undefined && entry.longitude !== undefined
              ? { latitude: entry.latitude, longitude: entry.longitude }
              : undefined,
            {
              occurredAt: entry.occurredAt,
              clientEventId: entry.clientEventId,
              offlineSync: true,
              officeLocationId: entry.officeLocationId,
            },
          );
          // Idempotent server-side (no-ops if already attached) — safe to
          // resend even if the attendance insert above was itself a no-op
          // replay of an already-synced entry.
          if (entry.selfieBlob) {
            await this.selfieService.uploadForAttendance(entry.clientEventId, entry.selfieBlob);
          }
          await withStore('readwrite', (store) => store.delete(entry.clientEventId));
        } catch (err) {
          if (err instanceof UnauthorizedError) {
            // Retrying this (or anything queued behind it) can't succeed
            // until the user signs in online again — stop and surface that,
            // rather than silently retrying the same rejection forever.
            this.needsReauth.set(true);
          }
          // Still can't reach the server, or just hit the reauth wall above
          // — stop here, keep the rest queued in order, and let the next
          // online event / retry tick (or clearNeedsReauth()) try again.
          break;
        }
      }
    } finally {
      await this.refreshPendingCount();
      this.syncing.set(false);
      this.flushing = false;
    }
  }

  private async refreshPendingCount() {
    const entries = await withStore<PendingAttendanceEntry[]>('readonly', (store) =>
      store.getAll(),
    );
    this.pendingCount.set(entries.length);
  }
}
