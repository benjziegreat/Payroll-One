import {
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { AuthService } from '../../core/auth.service';
import type { BiometricMethod } from '../../core/attendance.service';
import { DeviceIdentityService } from '../../core/device-identity.service';
import { FaceService } from '../../core/face.service';
import { OfflineError } from '../../core/local-api.service';
import { OfflineQueueService } from '../../core/offline-queue.service';
import { WebauthnService } from '../../core/webauthn.service';
import { SelfieCaptureComponent } from '../selfie-capture/selfie-capture.component';

type Status = 'idle' | 'camera' | 'scanning' | 'verifying' | 'selfie' | 'error';

export interface BiometricConfirmResult {
  method: BiometricMethod;
  selfieBlob: Blob | null;
}

@Component({
  selector: 'app-biometric-modal',
  imports: [SelfieCaptureComponent],
  templateUrl: './biometric-modal.component.html',
  styleUrl: './biometric-modal.component.scss',
})
export class BiometricModalComponent implements OnInit, OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly faceService = inject(FaceService);
  private readonly deviceIdentity = inject(DeviceIdentityService);
  private readonly offlineQueue = inject(OfflineQueueService);
  private readonly webauthnService = inject(WebauthnService);

  readonly action = input.required<'login' | 'logout'>();
  readonly availableMethods = input.required<BiometricMethod[]>();
  /** From the employee's own record (auth.user()) — whether they must record a video selfie to complete this, vs. it being an optional extra step. */
  readonly requireSelfieVerification = input(false);

  readonly success = output<BiometricConfirmResult>();
  readonly cancel = output<void>();

  private verifiedMethod: BiometricMethod | null = null;

  private readonly video = viewChild<ElementRef<HTMLVideoElement>>('video');

  readonly selectedMethod = signal<BiometricMethod | null>(null);
  readonly status = signal<Status>('idle');
  readonly errorMessage = signal('');

  readonly actionLabel = computed(() => (this.action() === 'login' ? 'Clock In' : 'Clock Out'));

  private stream: MediaStream | null = null;

  ngOnInit() {
    const methods = this.availableMethods();
    if (methods.length === 1) {
      this.choose(methods[0]);
    }
  }

  async choose(method: BiometricMethod) {
    this.selectedMethod.set(method);
    this.errorMessage.set('');

    if (method === 'fingerprint') {
      await this.runFingerprint();
      return;
    }

    this.status.set('camera');
    setTimeout(() => this.startCamera(), 0);
  }

  private async startCamera() {
    const video = this.video()?.nativeElement;
    if (!video) return;
    try {
      this.stream = await this.faceService.startCamera(video);
      this.scanFace();
    } catch {
      this.status.set('error');
      this.errorMessage.set('Camera access was denied or is unavailable.');
    }
  }

  async scanFace() {
    const video = this.video()?.nativeElement;
    const user = this.auth.user();
    if (!video || !user) return;

    this.status.set('scanning');
    this.errorMessage.set('');
    try {
      const descriptor = await this.faceService.captureDescriptor(video);
      if (!descriptor) {
        this.status.set('camera');
        this.errorMessage.set('No face detected. Center your face in the frame and try again.');
        return;
      }

      this.status.set('verifying');
      const matched = await this.verifyFace(user.id, descriptor);
      if (matched) {
        this.stopCamera();
        this.verifiedMethod = 'face';
        this.status.set('selfie');
      } else {
        this.status.set('camera');
        this.errorMessage.set("Face didn't match. Try again with better lighting.");
      }
    } catch (err) {
      this.status.set('camera');
      this.errorMessage.set(err instanceof Error ? err.message : 'Face scan failed.');
    }
  }

  /** Verifies the live scan against the enrolled descriptor. Falls back to this device's offline-cached descriptor for the current user when the server can't be reached — the resulting clock-in/out still queues normally via OfflineQueueService once `success` is emitted, same as any other offline confirmation. */
  private async verifyFace(userId: string, descriptor: Float32Array): Promise<boolean> {
    if (!this.offlineQueue.isOnline()) {
      return this.verifyFaceOffline(userId, descriptor);
    }

    try {
      return await this.faceService.verifyAgainstEnrollment(userId, descriptor);
    } catch (err) {
      if (!(err instanceof OfflineError)) throw err;
      return this.verifyFaceOffline(userId, descriptor);
    }
  }

  private async verifyFaceOffline(userId: string, descriptor: Float32Array): Promise<boolean> {
    if (!(await this.deviceIdentity.hasCachedFace(userId))) {
      throw new Error("You're offline, and this device has no cached face data for you yet.");
    }
    return this.deviceIdentity.verifyOffline(userId, descriptor);
  }

  private async runFingerprint() {
    this.status.set('verifying');
    try {
      await this.webauthnService.authenticate();
      this.verifiedMethod = 'fingerprint';
      this.status.set('selfie');
    } catch (err) {
      this.status.set('error');
      const userId = this.auth.user()?.id;
      if (userId && !this.webauthnService.isEnrolledOnThisDevice(userId)) {
        this.errorMessage.set(
          "This device hasn't registered a fingerprint yet. Go to Enroll and add it on this device.",
        );
      } else {
        this.errorMessage.set(err instanceof Error ? err.message : 'Fingerprint check failed.');
      }
    }
  }

  onSelfieCaptured(blob: Blob) {
    if (!this.verifiedMethod) return;
    this.success.emit({ method: this.verifiedMethod, selfieBlob: blob });
  }

  onSelfieSkipped() {
    if (!this.verifiedMethod) return;
    this.success.emit({ method: this.verifiedMethod, selfieBlob: null });
  }

  retry() {
    const method = this.selectedMethod();
    this.selectedMethod.set(null);
    this.status.set('idle');
    this.errorMessage.set('');
    if (method) this.choose(method);
  }

  back() {
    this.stopCamera();
    this.selectedMethod.set(null);
    this.status.set('idle');
    this.errorMessage.set('');
  }

  close() {
    this.stopCamera();
    this.cancel.emit();
  }

  private stopCamera() {
    FaceService.stopCamera(this.stream);
    this.stream = null;
  }

  ngOnDestroy() {
    this.stopCamera();
  }
}
