import { Injectable, signal } from '@angular/core';
import type { AttendanceAction, BiometricMethod } from './attendance.service';
import type { Coordinates } from './geo.service';
import { KioskService, type KioskDirectoryUser, type KioskResult } from './kiosk.service';
import { OfflineError } from './local-api.service';

const DB_NAME = 'payroll_one_kiosk_offline';
const DB_VERSION = 1;
const DIRECTORY_STORE = 'directory';
const PENDING_STORE = 'pending';
const RETRY_INTERVAL_MS = 15000;
const FACE_MATCH_THRESHOLD = 0.55;

interface PendingKioskEntry {
  clientEventId: string;
  type: BiometricMethod;
  userId: string;
  action: AttendanceAction;
  descriptor?: number[];
  assertion?: unknown;
  latitude?: number;
  longitude?: number;
  occurredAt: string;
}

export interface OfflineMatch {
  userId: string;
  fullName: string;
  photoUrl: string | null;
  action: AttendanceAction;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DIRECTORY_STORE)) {
        db.createObjectStore(DIRECTORY_STORE, { keyPath: 'userId' });
      }
      if (!db.objectStoreNames.contains(PENDING_STORE)) {
        db.createObjectStore(PENDING_STORE, { keyPath: 'clientEventId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const request = fn(tx.objectStore(storeName));
        tx.oncomplete = () => resolve(request.result);
        tx.onerror = () => reject(tx.error ?? request.error);
      }),
  );
}

function euclideanDistance(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2;
  return Math.sqrt(sum);
}

function nextAction(lastAction: AttendanceAction | null): AttendanceAction {
  return lastAction === 'login' ? 'logout' : 'login';
}

function randomChallenge(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Lets the Kiosk page keep identifying and logging people (via face or
 * fingerprint) when the server is unreachable. The directory (face
 * descriptors + credential-id-to-user mapping) is cached in IndexedDB
 * whenever the server IS reachable; when it isn't, matching runs against
 * that cache instead, and the resulting event queues here for the real,
 * server-verified write once connectivity returns — mirroring
 * OfflineQueueService's pattern for the personal dashboard, just keyed by a
 * locally-determined userId instead of an authenticated session.
 *
 * Only active when an admin has opted into "offline kiosk mode" (see
 * AdminService.setKioskOfflineSupport) — see /kiosk/directory server-side,
 * which refuses to serve the directory otherwise. That gate exists because
 * caching this data on a shared/public kiosk device is a real exposure.
 */
@Injectable({ providedIn: 'root' })
export class KioskOfflineService {
  readonly pendingCount = signal(0);
  readonly syncing = signal(false);
  readonly lastSyncError = signal<string | null>(null);

  private flushing = false;
  private refreshing = false;

  constructor(private readonly kioskService: KioskService) {
    window.addEventListener('online', () => {
      this.refreshDirectory();
      this.flush();
    });

    this.refreshPendingCount();
    this.refreshDirectory();
    this.flush();
    setInterval(() => this.flush(), RETRY_INTERVAL_MS);
  }

  /** Re-download the offline directory. Safe to call opportunistically (e.g. after any successful online identify) — no-ops quietly if unreachable or not enabled. */
  async refreshDirectory() {
    if (this.refreshing || !navigator.onLine) return;
    this.refreshing = true;
    try {
      const enabled = await this.kioskService.getOfflineSupport();
      if (!enabled) {
        await this.clearDirectory();
        return;
      }
      const users = await this.kioskService.getDirectory();
      await this.replaceDirectory(users);
    } catch {
      // Unreachable or disabled — keep whatever directory we already have
      // cached rather than clearing it out from under an in-progress outage.
    } finally {
      this.refreshing = false;
    }
  }

  async hasCachedDirectory(): Promise<boolean> {
    const users = await withStore<KioskDirectoryUser[]>(DIRECTORY_STORE, 'readonly', (store) =>
      store.getAll(),
    );
    return users.length > 0;
  }

  async matchFaceOffline(descriptor: Float32Array): Promise<OfflineMatch | null> {
    const users = await withStore<KioskDirectoryUser[]>(DIRECTORY_STORE, 'readonly', (store) =>
      store.getAll(),
    );

    let best: KioskDirectoryUser | null = null;
    let bestDistance = Infinity;
    for (const user of users) {
      if (!user.faceDescriptor) continue;
      const distance = euclideanDistance(user.faceDescriptor, Array.from(descriptor));
      if (distance < bestDistance) {
        bestDistance = distance;
        best = user;
      }
    }

    if (!best || bestDistance > FACE_MATCH_THRESHOLD) return null;
    return {
      userId: best.userId,
      fullName: best.fullName,
      photoUrl: best.photoUrl,
      action: nextAction(best.lastAction),
    };
  }

  /** Runs the discoverable-credential WebAuthn ceremony against a locally-generated challenge (no server round trip needed), then maps the returned credential id back to a cached user. Returns both the match and the raw assertion, which the caller must queue via queueFingerprint for later server-side signature verification — this lookup alone is NOT a security check. */
  async matchFingerprintOffline(): Promise<{ match: OfflineMatch; assertion: unknown } | null> {
    const { startAuthentication } = await import('@simplewebauthn/browser');
    const assertion = await startAuthentication({
      optionsJSON: {
        challenge: randomChallenge(),
        rpId: location.hostname,
        userVerification: 'required',
        allowCredentials: [],
      },
    });

    const users = await withStore<KioskDirectoryUser[]>(DIRECTORY_STORE, 'readonly', (store) =>
      store.getAll(),
    );
    const user = users.find((u) => u.credentials.some((c) => c.credentialId === assertion.id));
    if (!user) return null;

    return {
      match: {
        userId: user.userId,
        fullName: user.fullName,
        photoUrl: user.photoUrl,
        action: nextAction(user.lastAction),
      },
      assertion,
    };
  }

  async queueFace(
    match: OfflineMatch,
    descriptor: Float32Array,
    location: Coordinates | undefined,
    occurredAt: string,
    clientEventId: string,
  ) {
    await this.enqueue({
      clientEventId,
      type: 'face',
      userId: match.userId,
      action: match.action,
      descriptor: Array.from(descriptor),
      latitude: location?.latitude,
      longitude: location?.longitude,
      occurredAt,
    });
  }

  async queueFingerprint(
    match: OfflineMatch,
    assertion: unknown,
    location: Coordinates | undefined,
    occurredAt: string,
    clientEventId: string,
  ) {
    await this.enqueue({
      clientEventId,
      type: 'fingerprint',
      userId: match.userId,
      action: match.action,
      assertion,
      latitude: location?.latitude,
      longitude: location?.longitude,
      occurredAt,
    });
  }

  private async enqueue(entry: PendingKioskEntry) {
    await withStore(PENDING_STORE, 'readwrite', (store) => store.put(entry));
    await this.bumpLastAction(entry.userId, entry.action);
    await this.refreshPendingCount();
  }

  async flush() {
    if (this.flushing || !navigator.onLine) return;
    this.flushing = true;
    this.syncing.set(true);
    try {
      const entries = await withStore<PendingKioskEntry[]>(PENDING_STORE, 'readonly', (store) =>
        store.getAll(),
      );
      entries.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));

      for (const entry of entries) {
        try {
          if (entry.type === 'face') {
            await this.kioskService.syncFace(
              entry.descriptor!,
              this.entryLocation(entry),
              entry.occurredAt,
              entry.clientEventId,
            );
          } else {
            await this.kioskService.syncFingerprint(
              entry.assertion,
              this.entryLocation(entry),
              entry.occurredAt,
              entry.clientEventId,
            );
          }
          await withStore(PENDING_STORE, 'readwrite', (store) => store.delete(entry.clientEventId));
        } catch (err) {
          if (err instanceof OfflineError) {
            // Still can't reach the server — stop here, keep the rest queued
            // in order, and let the next online event / retry tick try again.
            break;
          }
          // The server explicitly rejected this one (e.g. the employee's
          // enrolled face changed since the kiosk last cached the
          // directory, or offline mode's since been turned off) — it can't
          // succeed by retrying, so drop it rather than blocking everything
          // queued behind it.
          this.lastSyncError.set(err instanceof Error ? err.message : 'A queued entry failed to sync.');
          await withStore(PENDING_STORE, 'readwrite', (store) => store.delete(entry.clientEventId));
        }
      }
    } finally {
      await this.refreshPendingCount();
      this.syncing.set(false);
      this.flushing = false;
    }
  }

  private entryLocation(entry: PendingKioskEntry): Coordinates | undefined {
    return entry.latitude !== undefined && entry.longitude !== undefined
      ? { latitude: entry.latitude, longitude: entry.longitude }
      : undefined;
  }

  private async bumpLastAction(userId: string, action: AttendanceAction) {
    const user = await withStore<KioskDirectoryUser | undefined>(
      DIRECTORY_STORE,
      'readonly',
      (store) => store.get(userId),
    );
    if (!user) return;
    await withStore(DIRECTORY_STORE, 'readwrite', (store) =>
      store.put({ ...user, lastAction: action }),
    );
  }

  private async replaceDirectory(users: KioskDirectoryUser[]) {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(DIRECTORY_STORE, 'readwrite');
      const store = tx.objectStore(DIRECTORY_STORE);
      store.clear();
      for (const user of users) store.put(user);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  private async clearDirectory() {
    await withStore(DIRECTORY_STORE, 'readwrite', (store) => store.clear());
  }

  private async refreshPendingCount() {
    const entries = await withStore<PendingKioskEntry[]>(PENDING_STORE, 'readonly', (store) =>
      store.getAll(),
    );
    this.pendingCount.set(entries.length);
  }
}
