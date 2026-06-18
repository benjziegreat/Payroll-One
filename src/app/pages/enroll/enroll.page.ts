import {
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { FaceService } from '../../core/face.service';
import { WebauthnService } from '../../core/webauthn.service';

@Component({
  selector: 'app-enroll-page',
  imports: [],
  templateUrl: './enroll.page.html',
  styleUrl: './enroll.page.scss',
})
export class EnrollPage implements OnInit, OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly faceService = inject(FaceService);
  private readonly webauthnService = inject(WebauthnService);
  private readonly router = inject(Router);

  private readonly video = viewChild<ElementRef<HTMLVideoElement>>('video');
  private stream: MediaStream | null = null;

  readonly faceEnrolled = signal(false);
  readonly fingerprintEnrolled = signal(false);
  readonly webauthnSupported = this.webauthnService.isSupported();

  readonly faceCameraOpen = signal(false);
  readonly faceBusy = signal(false);
  readonly faceError = signal('');

  readonly fingerprintBusy = signal(false);
  readonly fingerprintError = signal('');

  async ngOnInit() {
    const user = this.auth.user();
    if (!user) return;
    const [face, fingerprint] = await Promise.all([
      this.faceService.isEnrolled(user.id),
      this.webauthnService.isEnrolled(user.id),
    ]);
    this.faceEnrolled.set(face);
    this.fingerprintEnrolled.set(fingerprint);
  }

  async openFaceCamera() {
    this.faceError.set('');
    this.faceCameraOpen.set(true);
    setTimeout(async () => {
      const video = this.video()?.nativeElement;
      if (!video) return;
      try {
        this.stream = await this.faceService.startCamera(video);
      } catch {
        this.faceError.set('Camera access was denied or is unavailable.');
        this.faceCameraOpen.set(false);
      }
    }, 0);
  }

  async captureFace() {
    const video = this.video()?.nativeElement;
    const user = this.auth.user();
    if (!video || !user) return;

    this.faceBusy.set(true);
    this.faceError.set('');
    try {
      const descriptor = await this.faceService.captureDescriptor(video);
      if (!descriptor) {
        this.faceError.set('No face detected. Center your face in the frame and try again.');
        return;
      }
      await this.faceService.saveEnrollment(user.id, descriptor);
      this.faceEnrolled.set(true);
      this.closeFaceCamera();
    } catch (err) {
      this.faceError.set(err instanceof Error ? err.message : 'Could not enroll face.');
    } finally {
      this.faceBusy.set(false);
    }
  }

  closeFaceCamera() {
    FaceService.stopCamera(this.stream);
    this.stream = null;
    this.faceCameraOpen.set(false);
  }

  async enrollFingerprint() {
    this.fingerprintBusy.set(true);
    this.fingerprintError.set('');
    try {
      await this.webauthnService.register();
      this.fingerprintEnrolled.set(true);
    } catch (err) {
      this.fingerprintError.set(err instanceof Error ? err.message : 'Could not enroll fingerprint.');
    } finally {
      this.fingerprintBusy.set(false);
    }
  }

  continue() {
    this.router.navigateByUrl('/dashboard');
  }

  ngOnDestroy() {
    FaceService.stopCamera(this.stream);
  }
}
