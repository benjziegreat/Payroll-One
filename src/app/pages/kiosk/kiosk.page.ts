import { Component, ElementRef, OnDestroy, inject, signal, viewChild } from '@angular/core';
import { FaceService } from '../../core/face.service';
import { GeoService, type Coordinates } from '../../core/geo.service';
import { KioskOfflineService } from '../../core/kiosk-offline.service';
import { KioskService, type KioskResult } from '../../core/kiosk.service';
import { OfflineError } from '../../core/local-api.service';
import { WebauthnService } from '../../core/webauthn.service';
import { UserAvatarComponent } from '../../shared/user-avatar/user-avatar.component';

type Status = 'idle' | 'camera' | 'scanning' | 'fingerprint' | 'result' | 'error';
type KioskUiResult = KioskResult & { queued?: boolean };

@Component({
  selector: 'app-kiosk-page',
  imports: [UserAvatarComponent],
  templateUrl: './kiosk.page.html',
  styleUrl: './kiosk.page.scss',
})
export class KioskPage implements OnDestroy {
  private readonly faceService = inject(FaceService);
  private readonly geoService = inject(GeoService);
  private readonly kioskService = inject(KioskService);
  private readonly kioskOfflineService = inject(KioskOfflineService);
  private readonly webauthnService = inject(WebauthnService);

  private readonly video = viewChild<ElementRef<HTMLVideoElement>>('video');
  private stream: MediaStream | null = null;
  private autoScanAbort: AbortController | null = null;

  readonly webauthnSupported = this.webauthnService.isSupported();
  readonly status = signal<Status>('idle');
  readonly errorMessage = signal('');
  readonly result = signal<KioskUiResult | null>(null);
  readonly pendingSyncCount = this.kioskOfflineService.pendingCount;

  async chooseFace() {
    this.errorMessage.set('');
    this.status.set('camera');
    setTimeout(async () => {
      const video = this.video()?.nativeElement;
      if (!video) return;
      try {
        this.stream = await this.faceService.startCamera(video);
        this.startAutoScan(video);
      } catch {
        this.status.set('error');
        this.errorMessage.set('Camera access was denied or is unavailable.');
      }
    }, 0);
  }

  async scanFace() {
    const video = this.video()?.nativeElement;
    if (!video) return;
    this.stopAutoScan();

    this.status.set('scanning');
    this.errorMessage.set('');
    try {
      const descriptor = await this.faceService.captureDescriptor(video);
      if (!descriptor) {
        this.status.set('camera');
        this.errorMessage.set('No face detected. Center your face in the frame and try again.');
        this.startAutoScan(video);
        return;
      }

      const location = await this.getLocation();
      const result = await this.identifyFace(descriptor, location, crypto.randomUUID());
      this.stopCamera();
      this.result.set(result);
      this.status.set('result');
    } catch (err) {
      this.status.set('camera');
      this.errorMessage.set(err instanceof Error ? err.message : 'Face not recognized.');
      this.startAutoScan(video);
    }
  }

  private async identifyFace(
    descriptor: Float32Array,
    location: Coordinates | undefined,
    clientEventId: string,
  ): Promise<KioskUiResult> {
    try {
      const result = await this.kioskService.identifyByFace(descriptor, location, clientEventId);
      this.kioskOfflineService.refreshDirectory();
      return result;
    } catch (err) {
      // Only fall back to the offline-cached directory when the server was
      // actually unreachable — an explicit rejection (face not recognized)
      // from a server that IS reachable is authoritative and shouldn't be
      // second-guessed against a possibly-stale local cache.
      if (!(err instanceof OfflineError)) throw err;

      const match = await this.kioskOfflineService.matchFaceOffline(descriptor);
      if (!match) throw new Error('Face not recognized, and no offline match is cached.');

      const occurredAt = new Date().toISOString();
      await this.kioskOfflineService.queueFace(match, descriptor, location, occurredAt, clientEventId);
      return { fullName: match.fullName, photoUrl: match.photoUrl, action: match.action, queued: true };
    }
  }

  private startAutoScan(video: HTMLVideoElement) {
    this.stopAutoScan();
    const controller = new AbortController();
    this.autoScanAbort = controller;
    this.faceService
      .waitForStableFace(video, { signal: controller.signal })
      .then(() => {
        if (controller.signal.aborted) return;
        this.scanFace();
      })
      .catch(() => {
        // Aborted during teardown or manual scan — nothing to do.
      });
  }

  private stopAutoScan() {
    this.autoScanAbort?.abort();
    this.autoScanAbort = null;
  }

  async chooseFingerprint() {
    this.errorMessage.set('');
    this.status.set('fingerprint');
    try {
      const location = await this.getLocation();
      const result = await this.identifyFingerprint(location, crypto.randomUUID());
      this.result.set(result);
      this.status.set('result');
    } catch (err) {
      this.status.set('error');
      this.errorMessage.set(err instanceof Error ? err.message : 'Fingerprint not recognized.');
    }
  }

  private async identifyFingerprint(
    location: Coordinates | undefined,
    clientEventId: string,
  ): Promise<KioskUiResult> {
    try {
      const result = await this.kioskService.identifyByFingerprint(location, clientEventId);
      this.kioskOfflineService.refreshDirectory();
      return result;
    } catch (err) {
      if (!(err instanceof OfflineError)) throw err;

      // Couldn't even reach the server for authentication options — retry
      // the whole ceremony offline, against a locally-generated challenge,
      // rather than reusing anything from the failed attempt above.
      const offline = await this.kioskOfflineService.matchFingerprintOffline();
      if (!offline) throw new Error('Fingerprint not recognized, and no offline match is cached.');

      const occurredAt = new Date().toISOString();
      await this.kioskOfflineService.queueFingerprint(
        offline.match,
        offline.assertion,
        location,
        occurredAt,
        clientEventId,
      );
      return {
        fullName: offline.match.fullName,
        photoUrl: offline.match.photoUrl,
        action: offline.match.action,
        queued: true,
      };
    }
  }

  private async getLocation(): Promise<Coordinates | undefined> {
    try {
      return await this.geoService.getCurrentPosition();
    } catch {
      return undefined;
    }
  }

  reset() {
    this.stopCamera();
    this.result.set(null);
    this.errorMessage.set('');
    this.status.set('idle');
  }

  private stopCamera() {
    this.stopAutoScan();
    FaceService.stopCamera(this.stream);
    this.stream = null;
  }

  ngOnDestroy() {
    this.stopCamera();
  }
}
