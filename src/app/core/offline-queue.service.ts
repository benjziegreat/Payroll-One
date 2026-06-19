import { Injectable, signal } from '@angular/core';
import {
  AttendanceService,
  type AttendanceAction,
  type BiometricMethod,
} from './attendance.service';
import type { Coordinates } from './geo.service';

const DB_NAME = 'payroll_one_offline';
const DB_VERSION = 1;
const STORE_NAME = 'pending_attendance';
const RETRY_INTERVAL_MS = 15000;

export interface PendingAttendanceEntry {
  clientEventId: string;
  userId: string;
  action: AttendanceAction;
  method: BiometricMethod;
  latitude?: number;
  longitude?: number;
  occurredAt: string;
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
  readonly pendingCount = signal(0);
  readonly syncing = signal(false);

  private flushing = false;

  constructor(private readonly attendanceService: AttendanceService) {
    window.addEventListener('online', () => {
      this.isOnline.set(true);
      this.flush();
    });
    window.addEventListener('offline', () => this.isOnline.set(false));

    this.refreshPendingCount();
    if (this.isOnline()) this.flush();
    setInterval(() => {
      if (this.isOnline()) this.flush();
    }, RETRY_INTERVAL_MS);
  }

  /** Try to send immediately; if that fails for any reason, queue it for later. */
  async logOrQueue(
    userId: string,
    action: AttendanceAction,
    method: BiometricMethod,
    position: Coordinates | undefined,
    occurredAt: string,
    clientEventId: string,
  ): Promise<{ queued: boolean }> {
    if (this.isOnline()) {
      try {
        await this.attendanceService.logEvent(userId, action, method, position, {
          occurredAt,
          clientEventId,
        });
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
    });
    return { queued: true };
  }

  private async enqueue(entry: PendingAttendanceEntry) {
    await withStore('readwrite', (store) => store.put(entry));
    await this.refreshPendingCount();
  }

  async flush() {
    if (this.flushing) return;
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
            { occurredAt: entry.occurredAt, clientEventId: entry.clientEventId },
          );
          await withStore('readwrite', (store) => store.delete(entry.clientEventId));
        } catch {
          // Still can't reach the server — stop here, keep the rest queued
          // in order, and let the next online event / retry tick try again.
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
