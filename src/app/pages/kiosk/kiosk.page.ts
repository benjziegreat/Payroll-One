import { Component, ElementRef, OnDestroy, inject, signal, viewChild } from '@angular/core';
import { FaceService } from '../../core/face.service';
import { GeoService, type Coordinates } from '../../core/geo.service';
import { KioskService, type KioskResult } from '../../core/kiosk.service';
import { WebauthnService } from '../../core/webauthn.service';
import { UserAvatarComponent } from '../../shared/user-avatar/user-avatar.component';

type Status = 'idle' | 'camera' | 'scanning' | 'fingerprint' | 'result' | 'error';

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
  private readonly webauthnService = inject(WebauthnService);

  private readonly video = viewChild<ElementRef<HTMLVideoElement>>('video');
  private stream: MediaStream | null = null;
  private autoScanInterval: ReturnType<typeof setInterval> | null = null;
  private consecutiveDetections = 0;
  private static readonly AUTO_SCAN_POLL_MS = 400;
  private static readonly AUTO_SCAN_DETECTIONS_REQUIRED = 2;

  readonly webauthnSupported = this.webauthnService.isSupported();
  readonly status = signal<Status>('idle');
  readonly errorMessage = signal('');
  readonly result = signal<KioskResult | null>(null);

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
      const result = await this.kioskService.identifyByFace(
        descriptor,
        location,
        crypto.randomUUID(),
      );
      this.stopCamera();
      this.result.set(result);
      this.status.set('result');
    } catch (err) {
      this.status.set('camera');
      this.errorMessage.set(err instanceof Error ? err.message : 'Face not recognized.');
      this.startAutoScan(video);
    }
  }

  private startAutoScan(video: HTMLVideoElement) {
    this.stopAutoScan();
    this.consecutiveDetections = 0;
    let checkInFlight = false;
    this.autoScanInterval = setInterval(async () => {
      if (this.status() !== 'camera' || checkInFlight) return;
      checkInFlight = true;
      try {
        const detected = await this.faceService.detectFacePresence(video);
        if (!detected) {
          this.consecutiveDetections = 0;
          return;
        }
        this.consecutiveDetections++;
        if (this.consecutiveDetections >= KioskPage.AUTO_SCAN_DETECTIONS_REQUIRED) {
          this.stopAutoScan();
          this.scanFace();
        }
      } catch {
        // Transient detection failure — keep polling.
      } finally {
        checkInFlight = false;
      }
    }, KioskPage.AUTO_SCAN_POLL_MS);
  }

  private stopAutoScan() {
    if (this.autoScanInterval !== null) {
      clearInterval(this.autoScanInterval);
      this.autoScanInterval = null;
    }
  }

  async chooseFingerprint() {
    this.errorMessage.set('');
    this.status.set('fingerprint');
    try {
      const location = await this.getLocation();
      const result = await this.kioskService.identifyByFingerprint(
        location,
        crypto.randomUUID(),
      );
      this.result.set(result);
      this.status.set('result');
    } catch (err) {
      this.status.set('error');
      this.errorMessage.set(err instanceof Error ? err.message : 'Fingerprint not recognized.');
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
