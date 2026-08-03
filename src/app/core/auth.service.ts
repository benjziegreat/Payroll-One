import { Injectable, computed, signal } from '@angular/core';
import type { Session } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';
import { DeviceIdentityService } from './device-identity.service';
import { FaceService } from './face.service';
import { LocalApiService, OfflineError } from './local-api.service';
import { SupabaseService } from './supabase.service';
import type { AppUser } from './types';

const CACHED_USER_KEY = 'payroll_one_local_user';

@Injectable({ providedIn: 'root' })
export class AuthService {
  readonly session = signal<Session | null>(null);
  readonly user = signal<AppUser | null>(null);
  readonly ready = signal(false);
  readonly readyPromise: Promise<void>;

  /** True once signed in from this device's offline face-match cache rather than a real server-issued token — API calls needing auth will fail until the user confirms their identity online again (see restoreOfflineSession). */
  readonly isOfflineSession = computed(
    () => this.isLocal && !!this.user() && !this.localApi.getToken(),
  );

  private readonly isLocal = environment.backend === 'local';

  constructor(
    private readonly supabase: SupabaseService,
    private readonly localApi: LocalApiService,
    private readonly faceService: FaceService,
    private readonly deviceIdentity: DeviceIdentityService,
  ) {
    this.readyPromise = this.isLocal ? this.initLocal() : this.initSupabase();
  }

  /** Best-effort — caches this device's own face descriptor for offline sign-in. Never throws. */
  private async refreshDeviceIdentity(user: AppUser) {
    try {
      const descriptor = await this.faceService.getMyDescriptor(user.id);
      if (descriptor) await this.deviceIdentity.remember(user, descriptor);
    } catch {
      // Offline or not enrolled — nothing to cache yet, not an error.
    }
  }

  /** Restores a session identified via DeviceIdentityService's local face match when the server can't be reached at all. No token exists for this session — isOfflineSession() will be true until the user confirms their identity online again. */
  restoreOfflineSession(user: AppUser) {
    this.user.set(user);
    this.cacheUser(user);
    this.ready.set(true);
  }

  private async initSupabase() {
    const { data } = await this.supabase.client.auth.getSession();
    this.session.set(data.session);
    this.user.set(data.session?.user ?? null);
    this.ready.set(true);

    this.supabase.client.auth.onAuthStateChange((_event, session) => {
      this.session.set(session);
      this.user.set(session?.user ?? null);
    });
  }

  private async initLocal() {
    if (this.localApi.getToken()) {
      try {
        const { user } = await this.localApi.request<{ user: AppUser }>('/auth/me');
        this.user.set(user);
        this.cacheUser(user);
        this.refreshDeviceIdentity(user);
      } catch (err) {
        if (err instanceof OfflineError) {
          // Can't reach the server to confirm the session, but the token
          // might still be perfectly valid — restore the last-known user
          // instead of signing them out just because they're offline.
          const cached = this.getCachedUser();
          if (cached) this.user.set(cached);
        } else {
          // The server explicitly rejected the token (expired/invalid).
          this.localApi.setToken(null);
          this.clearCachedUser();
        }
      }
    }
    this.ready.set(true);
  }

  private cacheUser(user: AppUser) {
    localStorage.setItem(CACHED_USER_KEY, JSON.stringify(user));
  }

  private getCachedUser(): AppUser | null {
    const raw = localStorage.getItem(CACHED_USER_KEY);
    return raw ? (JSON.parse(raw) as AppUser) : null;
  }

  private clearCachedUser() {
    localStorage.removeItem(CACHED_USER_KEY);
  }

  async signUp(email: string, password: string, fullName: string) {
    if (this.isLocal) {
      const { token, user } = await this.localApi.request<{ token: string; user: AppUser }>(
        '/auth/signup',
        { body: { email, password, fullName }, auth: false },
      );
      this.localApi.setToken(token);
      this.user.set(user);
      this.cacheUser(user);
      // Awaited deliberately — this runs right before AuthPage navigates
      // away, and a fire-and-forget write here can lose the race against
      // that navigation (or the tab backgrounding on mobile right after a
      // successful login) before the IndexedDB write actually commits.
      await this.deviceIdentity.rememberPassword(user, password);
      return;
    }

    const { error } = await this.supabase.client.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    });
    if (error) throw error;
  }

  async signIn(email: string, password: string) {
    if (this.isLocal) {
      const { token, user } = await this.localApi.request<{ token: string; user: AppUser }>(
        '/auth/signin',
        { body: { email, password }, auth: false },
      );
      this.localApi.setToken(token);
      this.user.set(user);
      this.cacheUser(user);
      // Awaited for the same reason as signUp() above — must commit before
      // this resolves, since the caller navigates away right after.
      await this.refreshDeviceIdentity(user);
      await this.deviceIdentity.rememberPassword(user, password);
      return;
    }

    const { error } = await this.supabase.client.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }

  async signInWithFace(descriptor: Float32Array) {
    if (!this.isLocal) {
      throw new Error('Face sign-in is only available on the local backend.');
    }
    const { token, user } = await this.localApi.request<{ token: string; user: AppUser }>(
      '/auth/face-signin',
      { body: { descriptor: Array.from(descriptor) }, auth: false },
    );
    // Already have a server-confirmed descriptor+user pair from this exact
    // call — cache it directly rather than doing a second round trip.
    // Awaited before returning, same reasoning as signIn()/signUp() above.
    await this.deviceIdentity.remember(user, Array.from(descriptor));
    this.localApi.setToken(token);
    this.user.set(user);
    this.cacheUser(user);
  }

  async signOut() {
    if (this.isLocal) {
      this.localApi.setToken(null);
      this.clearCachedUser();
      this.user.set(null);
      return;
    }

    const { error } = await this.supabase.client.auth.signOut();
    if (error) throw error;
  }

  async accessToken(): Promise<string | null> {
    if (this.isLocal) return this.localApi.getToken();
    const { data } = await this.supabase.client.auth.getSession();
    return data.session?.access_token ?? null;
  }
}
