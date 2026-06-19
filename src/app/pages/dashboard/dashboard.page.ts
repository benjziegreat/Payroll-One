import { DatePipe } from '@angular/common';
import {
  Component,
  ElementRef,
  OnDestroy,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import {
  AttendanceService,
  type AttendanceAction,
  type BiometricMethod,
} from '../../core/attendance.service';
import { FaceService } from '../../core/face.service';
import { GeoService, type Coordinates } from '../../core/geo.service';
import { OfficeLocationService } from '../../core/office-location.service';
import { OfflineQueueService } from '../../core/offline-queue.service';
import { ProfilePhotoService } from '../../core/profile-photo.service';
import { WebauthnService } from '../../core/webauthn.service';
import { BiometricModalComponent } from '../../shared/biometric-modal/biometric-modal.component';
import { UserAvatarComponent } from '../../shared/user-avatar/user-avatar.component';

const GEOFENCE_MIN_RADIUS_METERS = 0;
const GEOFENCE_MAX_RADIUS_METERS = 10;

@Component({
  selector: 'app-dashboard-page',
  imports: [DatePipe, BiometricModalComponent, UserAvatarComponent],
  templateUrl: './dashboard.page.html',
  styleUrl: './dashboard.page.scss',
})
export class DashboardPage implements OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly attendanceService = inject(AttendanceService);
  private readonly faceService = inject(FaceService);
  private readonly geoService = inject(GeoService);
  private readonly officeLocationService = inject(OfficeLocationService);
  private readonly offlineQueue = inject(OfflineQueueService);
  private readonly profilePhotoService = inject(ProfilePhotoService);
  private readonly webauthnService = inject(WebauthnService);
  private readonly router = inject(Router);

  readonly user = this.auth.user;
  readonly fullName = computed(
    () => (this.user()?.user_metadata?.['full_name'] as string | undefined) ?? this.user()?.email,
  );

  private readonly photoVideo = viewChild<ElementRef<HTMLVideoElement>>('photoVideo');
  private photoStream: MediaStream | null = null;

  readonly photoUrl = signal<string | null>(null);
  readonly photoUploading = signal(false);
  readonly photoError = signal<string | null>(null);
  readonly photoCameraOpen = signal(false);

  readonly lastAction = signal<AttendanceAction | null>(null);
  readonly lastAt = signal<string | null>(null);
  readonly nextAction = computed<AttendanceAction>(() =>
    this.lastAction() === 'login' ? 'logout' : 'login',
  );

  readonly availableMethods = signal<BiometricMethod[]>([]);
  readonly modalOpen = signal(false);
  readonly justLogged = signal<{
    action: AttendanceAction;
    method: BiometricMethod;
    queued: boolean;
  } | null>(null);
  readonly loading = signal(true);

  readonly isOnline = this.offlineQueue.isOnline;
  readonly pendingSyncCount = this.offlineQueue.pendingCount;
  readonly syncing = this.offlineQueue.syncing;

  readonly officeLocation = signal<Coordinates | null>(null);
  readonly position = this.geoService.position;
  readonly geoError = this.geoService.error;
  readonly settingOfficeLocation = signal(false);
  readonly officeLocationMessage = signal<string | null>(null);

  readonly geofenceMinLabel = GeoService.formatDistance(GEOFENCE_MIN_RADIUS_METERS);
  readonly geofenceMaxLabel = GeoService.formatDistance(GEOFENCE_MAX_RADIUS_METERS);

  readonly distanceMeters = computed(() => {
    const office = this.officeLocation();
    const pos = this.position();
    if (!office || !pos) return null;
    return Math.round(GeoService.distanceMeters(office, pos));
  });

  readonly distanceLabel = computed(() => {
    const meters = this.distanceMeters();
    return meters === null ? null : GeoService.formatDistance(meters);
  });

  readonly rangeStatus = computed<'too-close' | 'too-far' | 'in-range' | null>(() => {
    const distance = this.distanceMeters();
    if (distance === null) return null;
    if (distance < GEOFENCE_MIN_RADIUS_METERS) return 'too-close';
    if (distance > GEOFENCE_MAX_RADIUS_METERS) return 'too-far';
    return 'in-range';
  });

  readonly withinRange = computed(() => {
    if (!this.officeLocation()) return true;
    return this.rangeStatus() === 'in-range';
  });

  constructor() {
    this.load();
  }

  private async load() {
    const user = this.user();
    if (!user) return;
    this.loading.set(true);

    const [history, face, fingerprint, officeLocation] = await Promise.all([
      this.attendanceService.getHistory(user.id, 1).catch(() => null),
      this.faceService.isEnrolled(user.id).catch(() => false),
      this.webauthnService.isEnrolled(user.id).catch(() => false),
      this.officeLocationService.get().catch(() => null),
    ]);

    if (history) {
      const action = history[0]?.action ?? null;
      const at = history[0]?.created_at ?? null;
      this.lastAction.set(action);
      this.lastAt.set(at);
      this.cacheLastState(user.id, action, at);
    } else {
      // Couldn't reach the server (offline) — fall back to whatever we last
      // knew locally rather than getting stuck on a failed network call.
      const cached = this.getCachedLastState(user.id);
      this.lastAction.set(cached?.action ?? null);
      this.lastAt.set(cached?.at ?? null);
    }

    this.officeLocation.set(officeLocation);
    this.photoUrl.set(user.user_metadata?.photo_url ?? null);

    const methods: BiometricMethod[] = [];
    if (face) methods.push('face');
    if (fingerprint) methods.push('fingerprint');
    this.availableMethods.set(methods);

    this.loading.set(false);
    this.geoService.watch();
  }

  private lastStateKey(userId: string): string {
    return `payroll_one_last_state_${userId}`;
  }

  private cacheLastState(userId: string, action: AttendanceAction | null, at: string | null) {
    localStorage.setItem(this.lastStateKey(userId), JSON.stringify({ action, at }));
  }

  private getCachedLastState(
    userId: string,
  ): { action: AttendanceAction | null; at: string | null } | null {
    const raw = localStorage.getItem(this.lastStateKey(userId));
    return raw ? (JSON.parse(raw) as { action: AttendanceAction | null; at: string | null }) : null;
  }

  openModal() {
    this.justLogged.set(null);
    this.modalOpen.set(true);
  }

  async onSuccess(method: BiometricMethod) {
    const user = this.user();
    if (!user) return;
    const action = this.nextAction();
    const occurredAt = new Date().toISOString();
    const clientEventId = crypto.randomUUID();

    // Update the UI immediately — the whole point of offline support is that
    // a confirmed biometric match isn't held hostage by the network.
    this.lastAction.set(action);
    this.lastAt.set(occurredAt);
    this.cacheLastState(user.id, action, occurredAt);
    this.modalOpen.set(false);

    const { queued } = await this.offlineQueue.logOrQueue(
      user.id,
      action,
      method,
      this.position() ?? undefined,
      occurredAt,
      clientEventId,
    );
    this.justLogged.set({ action, method, queued });
  }

  onCancel() {
    this.modalOpen.set(false);
  }

  async setOfficeLocationHere() {
    this.settingOfficeLocation.set(true);
    this.officeLocationMessage.set(null);
    try {
      const coords = await this.geoService.getCurrentPosition();
      await this.officeLocationService.set(coords);
      this.officeLocation.set(coords);
      this.officeLocationMessage.set('Office location updated to your current position.');
    } catch (err) {
      this.officeLocationMessage.set(
        err instanceof Error ? err.message : 'Could not read your current location.',
      );
    } finally {
      this.settingOfficeLocation.set(false);
    }
  }

  manageEnrollment() {
    this.router.navigateByUrl('/enroll');
  }

  async onPhotoSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    await this.uploadPhoto(file);
    input.value = '';
  }

  async openPhotoCamera() {
    this.photoError.set(null);
    this.photoCameraOpen.set(true);
    setTimeout(async () => {
      const video = this.photoVideo()?.nativeElement;
      if (!video) return;
      try {
        this.photoStream = await this.faceService.startCamera(video);
      } catch {
        this.photoError.set('Camera access was denied or is unavailable.');
        this.photoCameraOpen.set(false);
      }
    }, 0);
  }

  closePhotoCamera() {
    FaceService.stopCamera(this.photoStream);
    this.photoStream = null;
    this.photoCameraOpen.set(false);
  }

  async capturePhoto() {
    const video = this.photoVideo()?.nativeElement;
    if (!video) return;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.92),
    );
    if (!blob) {
      this.photoError.set('Could not capture photo.');
      return;
    }

    const file = new File([blob], 'profile.jpg', { type: 'image/jpeg' });
    await this.uploadPhoto(file);
    if (!this.photoError()) this.closePhotoCamera();
  }

  private async uploadPhoto(file: File) {
    this.photoUploading.set(true);
    this.photoError.set(null);
    try {
      const photoUrl = await this.profilePhotoService.upload(file);
      this.photoUrl.set(photoUrl);
    } catch (err) {
      this.photoError.set(err instanceof Error ? err.message : 'Could not upload photo.');
    } finally {
      this.photoUploading.set(false);
    }
  }

  ngOnDestroy() {
    this.geoService.stopWatching();
    FaceService.stopCamera(this.photoStream);
  }
}
