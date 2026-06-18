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
import { FaceService } from '../../core/face.service';
import { WebauthnService } from '../../core/webauthn.service';

type Status = 'idle' | 'camera' | 'scanning' | 'verifying' | 'error';

@Component({
  selector: 'app-biometric-modal',
  imports: [],
  templateUrl: './biometric-modal.component.html',
  styleUrl: './biometric-modal.component.scss',
})
export class BiometricModalComponent implements OnInit, OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly faceService = inject(FaceService);
  private readonly webauthnService = inject(WebauthnService);

  readonly action = input.required<'login' | 'logout'>();
  readonly availableMethods = input.required<BiometricMethod[]>();

  readonly success = output<BiometricMethod>();
  readonly cancel = output<void>();

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
      const matched = await this.faceService.verifyAgainstEnrollment(user.id, descriptor);
      if (matched) {
        this.stopCamera();
        this.success.emit('face');
      } else {
        this.status.set('camera');
        this.errorMessage.set("Face didn't match. Try again with better lighting.");
      }
    } catch (err) {
      this.status.set('camera');
      this.errorMessage.set(err instanceof Error ? err.message : 'Face scan failed.');
    }
  }

  private async runFingerprint() {
    this.status.set('verifying');
    try {
      await this.webauthnService.authenticate();
      this.success.emit('fingerprint');
    } catch (err) {
      this.status.set('error');
      this.errorMessage.set(err instanceof Error ? err.message : 'Fingerprint check failed.');
    }
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
