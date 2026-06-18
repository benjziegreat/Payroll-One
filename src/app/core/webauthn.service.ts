import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';
import { SupabaseService } from './supabase.service';

@Injectable({ providedIn: 'root' })
export class WebauthnService {
  private readonly isLocal = environment.backend === 'local';
  private readonly basePath = this.isLocal ? `${environment.localApiBase}/webauthn` : '/api/webauthn';

  constructor(
    private readonly auth: AuthService,
    private readonly supabase: SupabaseService,
  ) {}

  isSupported(): boolean {
    return typeof window !== 'undefined' && !!window.PublicKeyCredential;
  }

  async isEnrolled(userId: string): Promise<boolean> {
    if (this.isLocal) {
      const result = await this.authedFetch(`${this.basePath}/status`, undefined, 'GET');
      return result.enrolled;
    }

    const { data, error } = await this.supabase.client
      .from('webauthn_credentials')
      .select('credential_id')
      .eq('user_id', userId)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return !!data;
  }

  private async authedFetch(path: string, body?: unknown, method = 'POST') {
    const token = await this.auth.accessToken();
    if (!token) throw new Error('Not signed in');

    const response = await fetch(path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error ?? `Request failed (${response.status})`);
    }
    return response.json();
  }

  async register(): Promise<void> {
    const { startRegistration } = await import('@simplewebauthn/browser');
    const optionsJSON = await this.authedFetch(`${this.basePath}/register-options`);
    const attestation = await startRegistration({ optionsJSON });
    const result = await this.authedFetch(`${this.basePath}/register-verify`, attestation);
    if (!result.verified) throw new Error('Fingerprint registration could not be verified');
  }

  async authenticate(): Promise<void> {
    const { startAuthentication } = await import('@simplewebauthn/browser');
    const optionsJSON = await this.authedFetch(`${this.basePath}/login-options`);
    const assertion = await startAuthentication({ optionsJSON });
    const result = await this.authedFetch(`${this.basePath}/login-verify`, assertion);
    if (!result.verified) throw new Error('Fingerprint could not be verified');
  }
}
