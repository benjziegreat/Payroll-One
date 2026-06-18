import { Injectable, signal } from '@angular/core';
import type { Session } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';
import { LocalApiService } from './local-api.service';
import { SupabaseService } from './supabase.service';
import type { AppUser } from './types';

@Injectable({ providedIn: 'root' })
export class AuthService {
  readonly session = signal<Session | null>(null);
  readonly user = signal<AppUser | null>(null);
  readonly ready = signal(false);
  readonly readyPromise: Promise<void>;

  private readonly isLocal = environment.backend === 'local';

  constructor(
    private readonly supabase: SupabaseService,
    private readonly localApi: LocalApiService,
  ) {
    this.readyPromise = this.isLocal ? this.initLocal() : this.initSupabase();
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
      } catch {
        this.localApi.setToken(null);
      }
    }
    this.ready.set(true);
  }

  async signUp(email: string, password: string, fullName: string) {
    if (this.isLocal) {
      const { token, user } = await this.localApi.request<{ token: string; user: AppUser }>(
        '/auth/signup',
        { body: { email, password, fullName }, auth: false },
      );
      this.localApi.setToken(token);
      this.user.set(user);
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
      return;
    }

    const { error } = await this.supabase.client.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }

  async signOut() {
    if (this.isLocal) {
      this.localApi.setToken(null);
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
