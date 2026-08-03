import { Injectable } from '@angular/core';
import bcrypt from 'bcryptjs';
import type { AppUser } from './types';

const DB_NAME = 'payroll_one_device_identity';
const DB_VERSION = 2;
const STORE_NAME = 'known_users';
const EMAIL_INDEX = 'email';
const MATCH_THRESHOLD = 0.55;
const PASSWORD_HASH_COST = 10;

interface KnownUserEntry {
  userId: string;
  email: string | null;
  fullName: string | null;
  photoUrl: string | null;
  faceDescriptor?: number[];
  // A LOCAL bcrypt hash of the account password (its own random salt, not
  // the server's stored hash) — computed and stored client-side ONLY so a
  // device that's already seen this user can verify them by password while
  // the server is unreachable. This is a real exposure the user explicitly
  // accepted after being warned an on-device PIN would be safer: anyone who
  // extracts this store gets a crackable copy of the account's password
  // hash, which — unlike a face descriptor — may be reused on other
  // accounts/services.
  passwordHash?: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      const store = db.objectStoreNames.contains(STORE_NAME)
        ? request.transaction!.objectStore(STORE_NAME)
        : db.createObjectStore(STORE_NAME, { keyPath: 'userId' });
      if (!store.indexNames.contains(EMAIL_INDEX)) {
        store.createIndex(EMAIL_INDEX, 'email', { unique: false });
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

function euclideanDistance(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2;
  return Math.sqrt(sum);
}

function toAppUser(entry: KnownUserEntry): AppUser {
  return {
    id: entry.userId,
    email: entry.email ?? undefined,
    user_metadata: { full_name: entry.fullName ?? undefined, photo_url: entry.photoUrl },
  };
}

/**
 * Remembers, on THIS device only, the credentials of whoever has
 * successfully signed in on it — a face descriptor, and (if the user opted
 * into it — see AuthService.rememberPasswordOffline) a local bcrypt hash of
 * their password — so if the device is later offline (server unreachable,
 * no valid session token cached) it can still identify that same person and
 * restore their session, rather than locking them out entirely until
 * connectivity returns.
 *
 * Deliberately scoped to "people who've used this specific device", not a
 * company-wide directory like the kiosk's offline mode — each entry only
 * ever gets written after a server-confirmed match for that exact user, so
 * this never caches anyone else's credentials.
 */
@Injectable({ providedIn: 'root' })
export class DeviceIdentityService {
  async remember(user: AppUser, descriptor: number[]) {
    await this.merge(user.id, {
      userId: user.id,
      email: user.email ?? null,
      fullName: user.user_metadata?.full_name ?? null,
      photoUrl: user.user_metadata?.photo_url ?? null,
      faceDescriptor: descriptor,
    });
  }

  async rememberPassword(user: AppUser, password: string) {
    const passwordHash = await bcrypt.hash(password, PASSWORD_HASH_COST);
    await this.merge(user.id, {
      userId: user.id,
      email: user.email ?? null,
      fullName: user.user_metadata?.full_name ?? null,
      photoUrl: user.user_metadata?.photo_url ?? null,
      passwordHash,
    });
  }

  async forget(userId: string) {
    await withStore('readwrite', (store) => store.delete(userId));
  }

  async matchOffline(liveDescriptor: Float32Array): Promise<AppUser | null> {
    const users = await withStore<KnownUserEntry[]>('readonly', (store) => store.getAll());

    let best: KnownUserEntry | null = null;
    let bestDistance = Infinity;
    for (const user of users) {
      if (!user.faceDescriptor) continue;
      const distance = euclideanDistance(user.faceDescriptor, Array.from(liveDescriptor));
      if (distance < bestDistance) {
        bestDistance = distance;
        best = user;
      }
    }

    if (!best || bestDistance > MATCH_THRESHOLD) return null;
    return toAppUser(best);
  }

  async matchPasswordOffline(email: string, password: string): Promise<AppUser | null> {
    const entry = await withStore<KnownUserEntry | undefined>('readonly', (store) =>
      store.index(EMAIL_INDEX).get(email),
    );
    if (!entry?.passwordHash) return null;
    const matched = await bcrypt.compare(password, entry.passwordHash);
    return matched ? toAppUser(entry) : null;
  }

  private async merge(userId: string, patch: Partial<KnownUserEntry>) {
    const existing = await withStore<KnownUserEntry | undefined>('readonly', (store) =>
      store.get(userId),
    );
    const entry: KnownUserEntry = {
      userId,
      email: null,
      fullName: null,
      photoUrl: null,
      ...existing,
      ...patch,
    };
    await withStore('readwrite', (store) => store.put(entry));
  }
}
