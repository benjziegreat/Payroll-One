import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';

const TOKEN_KEY = 'payroll_one_local_token';

@Injectable({ providedIn: 'root' })
export class LocalApiService {
  getToken(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  }

  setToken(token: string | null) {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  }

  async request<T>(
    path: string,
    options: { method?: string; body?: unknown; auth?: boolean } = {},
  ): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (options.auth !== false) {
      const token = this.getToken();
      if (token) headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${environment.localApiBase}${path}`, {
      method: options.method ?? (options.body !== undefined ? 'POST' : 'GET'),
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error((data as { error?: string }).error ?? `Request failed (${response.status})`);
    }
    return data as T;
  }
}
