import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';
import type { AttendanceAction } from './attendance.service';
import type { Coordinates } from './geo.service';
import { LocalApiService } from './local-api.service';

export interface KioskResult {
  fullName: string;
  photoUrl: string | null;
  action: AttendanceAction;
  requireSelfieVerification: boolean;
}

export interface KioskDirectoryCredential {
  credentialId: string;
  transports: string[];
}

export interface KioskDirectoryUser {
  userId: string;
  fullName: string;
  photoUrl: string | null;
  faceDescriptor: number[] | null;
  credentials: KioskDirectoryCredential[];
  lastAction: AttendanceAction | null;
  requireSelfieVerification: boolean;
}

@Injectable({ providedIn: 'root' })
export class KioskService {
  private readonly isLocal = environment.backend === 'local';

  constructor(private readonly localApi: LocalApiService) {}

  async getOfflineSupport(): Promise<boolean> {
    this.assertLocal();
    const { enabled } = await this.localApi.request<{ enabled: boolean }>('/kiosk/offline-support', {
      method: 'GET',
      auth: false,
    });
    return enabled;
  }

  async getDirectory(): Promise<KioskDirectoryUser[]> {
    this.assertLocal();
    const { users } = await this.localApi.request<{ users: KioskDirectoryUser[] }>(
      '/kiosk/directory',
      { method: 'GET', auth: false },
    );
    return users;
  }

  async syncFace(
    descriptor: number[],
    location: Coordinates | undefined,
    occurredAt: string,
    clientEventId: string,
  ): Promise<KioskResult> {
    this.assertLocal();
    return this.localApi.request<KioskResult>('/kiosk/sync', {
      auth: false,
      body: { type: 'face', descriptor, ...location, occurredAt, clientEventId },
    });
  }

  async syncFingerprint(
    assertion: unknown,
    location: Coordinates | undefined,
    occurredAt: string,
    clientEventId: string,
  ): Promise<KioskResult> {
    this.assertLocal();
    return this.localApi.request<KioskResult>('/kiosk/sync', {
      auth: false,
      body: { type: 'fingerprint', assertion, ...location, occurredAt, clientEventId },
    });
  }

  async identifyByFace(
    descriptor: Float32Array,
    location: Coordinates | undefined,
    clientEventId: string,
  ): Promise<KioskResult> {
    this.assertLocal();
    return this.localApi.request<KioskResult>('/kiosk/face', {
      auth: false,
      body: { descriptor: Array.from(descriptor), ...location, clientEventId },
    });
  }

  async identifyByFingerprint(
    location: Coordinates | undefined,
    clientEventId: string,
  ): Promise<KioskResult> {
    this.assertLocal();
    const { startAuthentication } = await import('@simplewebauthn/browser');
    const optionsJSON = await this.localApi.request<any>('/kiosk/fingerprint/options', {
      auth: false,
      body: {},
    });
    const assertion = await startAuthentication({ optionsJSON });
    return this.localApi.request<KioskResult>('/kiosk/fingerprint/verify', {
      auth: false,
      body: { ...assertion, ...location, clientEventId },
    });
  }

  private assertLocal() {
    if (!this.isLocal) {
      throw new Error('Kiosk mode is only available on the local backend.');
    }
  }
}
