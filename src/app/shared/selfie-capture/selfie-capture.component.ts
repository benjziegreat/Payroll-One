import {
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FaceService } from '../../core/face.service';

type Status = 'camera' | 'recording' | 'preview' | 'error';

const MAX_DURATION_MS = 8000;
const MIME_CANDIDATES = ['video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];

function pickMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const type of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return null;
}

/**
 * A short (max 8s) video-selfie recorder, shared by the dashboard's
 * biometric modal and the Kiosk page. Always offers the option to record —
 * `required` only controls whether "skip" is available, per the admin's
 * per-employee require-selfie-verification setting.
 */
@Component({
  selector: 'app-selfie-capture',
  imports: [],
  templateUrl: './selfie-capture.component.html',
  styleUrl: './selfie-capture.component.scss',
})
export class SelfieCaptureComponent implements OnInit, OnDestroy {
  private readonly faceService = inject(FaceService);

  readonly required = input(false);

  readonly captured = output<Blob>();
  readonly skipped = output<void>();

  private readonly video = viewChild<ElementRef<HTMLVideoElement>>('video');
  private readonly previewVideo = viewChild<ElementRef<HTMLVideoElement>>('previewVideo');

  readonly status = signal<Status>('camera');
  readonly errorMessage = signal('');
  readonly recordedSeconds = signal(0);
  readonly supported = typeof MediaRecorder !== 'undefined';

  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private recordedBlob: Blob | null = null;
  private previewUrl: string | null = null;
  private maxDurationTimer: ReturnType<typeof setTimeout> | null = null;
  private recordingTickHandle: ReturnType<typeof setInterval> | null = null;

  ngOnInit() {
    if (!this.supported) {
      this.status.set('error');
      this.errorMessage.set("This device doesn't support video recording.");
      return;
    }
    setTimeout(() => this.openCamera(), 0);
  }

  private async openCamera() {
    const video = this.video()?.nativeElement;
    if (!video) return;
    try {
      this.stream = await this.faceService.startCamera(video);
    } catch {
      this.status.set('error');
      this.errorMessage.set('Camera access was denied or is unavailable.');
    }
  }

  startRecording() {
    if (!this.stream) return;
    const mimeType = pickMimeType();
    if (!mimeType) {
      this.status.set('error');
      this.errorMessage.set("This device doesn't support video recording.");
      return;
    }

    this.chunks = [];
    this.recorder = new MediaRecorder(this.stream, { mimeType });
    this.recorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    };
    this.recorder.onstop = () => this.finishRecording(mimeType);
    this.recorder.start();

    this.status.set('recording');
    this.recordedSeconds.set(0);
    this.recordingTickHandle = setInterval(() => this.recordedSeconds.update((s) => s + 1), 1000);
    this.maxDurationTimer = setTimeout(() => this.stopRecording(), MAX_DURATION_MS);
  }

  stopRecording() {
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
    if (this.maxDurationTimer) clearTimeout(this.maxDurationTimer);
    if (this.recordingTickHandle) clearInterval(this.recordingTickHandle);
    this.maxDurationTimer = null;
    this.recordingTickHandle = null;
  }

  private finishRecording(mimeType: string) {
    this.recordedBlob = new Blob(this.chunks, { type: mimeType });
    this.stopCamera();
    this.status.set('preview');
    setTimeout(() => {
      const preview = this.previewVideo()?.nativeElement;
      if (preview && this.recordedBlob) {
        this.previewUrl = URL.createObjectURL(this.recordedBlob);
        preview.src = this.previewUrl;
      }
    }, 0);
  }

  retake() {
    this.recordedBlob = null;
    if (this.previewUrl) {
      URL.revokeObjectURL(this.previewUrl);
      this.previewUrl = null;
    }
    this.status.set('camera');
    setTimeout(() => this.openCamera(), 0);
  }

  confirm() {
    if (!this.recordedBlob) return;
    this.captured.emit(this.recordedBlob);
  }

  skip() {
    if (this.required()) return;
    this.stopCamera();
    this.skipped.emit();
  }

  private stopCamera() {
    FaceService.stopCamera(this.stream);
    this.stream = null;
  }

  ngOnDestroy() {
    this.stopRecording();
    this.stopCamera();
    if (this.previewUrl) URL.revokeObjectURL(this.previewUrl);
  }
}
