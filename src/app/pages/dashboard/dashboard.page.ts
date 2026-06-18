import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import {
  AttendanceService,
  type AttendanceAction,
  type BiometricMethod,
} from '../../core/attendance.service';
import { FaceService } from '../../core/face.service';
import { WebauthnService } from '../../core/webauthn.service';
import { BiometricModalComponent } from '../../shared/biometric-modal/biometric-modal.component';

@Component({
  selector: 'app-dashboard-page',
  imports: [DatePipe, BiometricModalComponent],
  templateUrl: './dashboard.page.html',
  styleUrl: './dashboard.page.scss',
})
export class DashboardPage {
  private readonly auth = inject(AuthService);
  private readonly attendanceService = inject(AttendanceService);
  private readonly faceService = inject(FaceService);
  private readonly webauthnService = inject(WebauthnService);
  private readonly router = inject(Router);

  readonly user = this.auth.user;
  readonly fullName = computed(
    () => (this.user()?.user_metadata?.['full_name'] as string | undefined) ?? this.user()?.email,
  );

  readonly lastAction = signal<AttendanceAction | null>(null);
  readonly lastAt = signal<string | null>(null);
  readonly nextAction = computed<AttendanceAction>(() =>
    this.lastAction() === 'login' ? 'logout' : 'login',
  );

  readonly availableMethods = signal<BiometricMethod[]>([]);
  readonly modalOpen = signal(false);
  readonly justLogged = signal<{ action: AttendanceAction; method: BiometricMethod } | null>(null);
  readonly loading = signal(true);

  constructor() {
    this.load();
  }

  private async load() {
    const user = this.user();
    if (!user) return;
    this.loading.set(true);

    const [history, face, fingerprint] = await Promise.all([
      this.attendanceService.getHistory(user.id, 1),
      this.faceService.isEnrolled(user.id),
      this.webauthnService.isEnrolled(user.id),
    ]);

    this.lastAction.set(history[0]?.action ?? null);
    this.lastAt.set(history[0]?.created_at ?? null);

    const methods: BiometricMethod[] = [];
    if (face) methods.push('face');
    if (fingerprint) methods.push('fingerprint');
    this.availableMethods.set(methods);

    this.loading.set(false);
  }

  openModal() {
    this.justLogged.set(null);
    this.modalOpen.set(true);
  }

  async onSuccess(method: BiometricMethod) {
    const user = this.user();
    if (!user) return;
    const action = this.nextAction();
    await this.attendanceService.logEvent(user.id, action, method);
    this.lastAction.set(action);
    this.lastAt.set(new Date().toISOString());
    this.justLogged.set({ action, method });
    this.modalOpen.set(false);
  }

  onCancel() {
    this.modalOpen.set(false);
  }

  manageEnrollment() {
    this.router.navigateByUrl('/enroll');
  }
}
