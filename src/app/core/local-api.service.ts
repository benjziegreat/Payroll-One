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

/**
 * The server WAS reached and explicitly rejected the request as
 * unauthenticated (missing/expired/invalid token) — as opposed to
 * OfflineError, where there was no response at all. Callers that retry on
 * failure (e.g. OfflineQueueService) need to tell these apart: retrying an
 * expired token changes nothing, so treating this the same as "still
 * offline" would retry forever without ever succeeding.
 */
export class UnauthorizedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnauthorizedError';
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

    return this.parseResponse<T>(response);
  }

  async uploadFile<T>(
    path: string,
    fieldName: string,
    file: File,
    method: 'POST' | 'PATCH' = 'POST',
  ): Promise<T> {
    const headers: Record<string, string> = {};
    const token = this.getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const body = new FormData();
    body.append(fieldName, file);

    const response = await this.fetch(`${environment.localApiBase}${path}`, {
      method,
      headers,
      body,
    });

    return this.parseResponse<T>(response);
  }

  private async parseResponse<T>(response: Response): Promise<T> {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = (data as { error?: string }).error ?? `Request failed (${response.status})`;
      if (response.status === 401) throw new UnauthorizedError(message);
      throw new Error(message);
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
