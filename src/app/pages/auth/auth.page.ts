import { Component, ElementRef, OnDestroy, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { environment } from '../../../environments/environment';
import { AuthService } from '../../core/auth.service';
import { FaceService } from '../../core/face.service';

@Component({
  selector: 'app-auth-page',
  imports: [FormsModule, RouterLink],
  templateUrl: './auth.page.html',
  styleUrl: './auth.page.scss',
})
export class AuthPage implements OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly faceService = inject(FaceService);
  private readonly router = inject(Router);

  private readonly video = viewChild<ElementRef<HTMLVideoElement>>('faceVideo');
  private stream: MediaStream | null = null;
  private autoScanAbort: AbortController | null = null;

  readonly faceSignInSupported = environment.backend === 'local';
  readonly mode = signal<'signin' | 'signup'>('signin');
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly info = signal<string | null>(null);

  readonly faceCameraOpen = signal(false);
  readonly faceScanning = signal(false);
  readonly faceError = signal('');

  fullName = '';
  email = '';
  password = '';

  setMode(mode: 'signin' | 'signup') {
    this.mode.set(mode);
    this.error.set(null);
    this.info.set(null);
    this.closeFaceSignIn();
  }

  async submit() {
    this.error.set(null);
    this.info.set(null);
    this.loading.set(true);
    try {
      if (this.mode() === 'signup') {
        await this.auth.signUp(this.email, this.password, this.fullName);
        if (this.auth.user()) {
          await this.router.navigateByUrl('/enroll');
        } else {
          this.info.set('Account created. Check your email to confirm, then sign in.');
          this.setMode('signin');
        }
      } else {
        await this.auth.signIn(this.email, this.password);
        await this.router.navigateByUrl('/dashboard');
      }
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      this.loading.set(false);
    }
  }

  async openFaceSignIn() {
    this.faceError.set('');
    this.faceCameraOpen.set(true);
    setTimeout(async () => {
      const video = this.video()?.nativeElement;
      if (!video) return;
      try {
        this.stream = await this.faceService.startCamera(video);
        this.startAutoScan(video);
      } catch {
        this.faceError.set('Camera access was denied or is unavailable.');
        this.faceCameraOpen.set(false);
      }
    }, 0);
  }

  private async scanFace() {
    const video = this.video()?.nativeElement;
    if (!video) return;
    this.stopAutoScan();

    this.faceScanning.set(true);
    this.faceError.set('');
    try {
      const descriptor = await this.faceService.captureDescriptor(video);
      if (!descriptor) {
        this.faceError.set('No face detected. Center your face in the frame and try again.');
        return;
      }

      await this.auth.signInWithFace(descriptor);
      this.closeFaceSignIn();
      await this.router.navigateByUrl('/dashboard');
    } catch (err) {
      this.faceError.set(err instanceof Error ? err.message : 'Face not recognized.');
    } finally {
      this.faceScanning.set(false);
      if (this.faceCameraOpen()) this.startAutoScan(video);
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

  closeFaceSignIn() {
    this.stopAutoScan();
    FaceService.stopCamera(this.stream);
    this.stream = null;
    this.faceCameraOpen.set(false);
    this.faceError.set('');
  }

  ngOnDestroy() {
    this.closeFaceSignIn();
  }
}
