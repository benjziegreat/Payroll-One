import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';

const TOKEN_KEY = 'payroll_one_local_token';

/**
 * Thrown when `fetch` itself fails (no connection, DNS, server unreachable) —
 * as opposed to a normal `Error` thrown for an explicit non-2xx response.
 * Callers use this to tell "we're offline" apart from "the server said no",
 * since those need very different handling (e.g. don't log the user out
 * just because they lost signal).
 */
export class OfflineError extends Error {
  constructor() {
    super('Network request failed — you appear to be offline.');
    this.name = 'OfflineError';
  }
}

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

    const response = await this.fetch(`${environment.localApiBase}${path}`, {
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

  async uploadFile<T>(path: string, fieldName: string, file: File): Promise<T> {
    const headers: Record<string, string> = {};
    const token = this.getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const body = new FormData();
    body.append(fieldName, file);

    const response = await this.fetch(`${environment.localApiBase}${path}`, {
      method: 'POST',
      headers,
      body,
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error((data as { error?: string }).error ?? `Request failed (${response.status})`);
    }
    return data as T;
  }

  private async fetch(url: string, init: RequestInit): Promise<Response> {
    try {
      return await fetch(url, init);
    } catch {
      throw new OfflineError();
    }
  }
}
