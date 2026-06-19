import { DatePipe } from '@angular/common';
import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { AdminService, type AdminAttendanceLogRow } from '../../core/admin.service';
import { AuthService } from '../../core/auth.service';
import { UserAvatarComponent } from '../../shared/user-avatar/user-avatar.component';

const REFRESH_INTERVAL_MS = 5000;
const LATE_SYNC_THRESHOLD_MS = 60_000;

@Component({
  selector: 'app-admin-logs-page',
  imports: [DatePipe, UserAvatarComponent],
  templateUrl: './admin-logs.page.html',
  styleUrl: './admin-logs.page.scss',
})
export class AdminLogsPage implements OnDestroy {
  private readonly adminService = inject(AdminService);
  private readonly auth = inject(AuthService);
  private refreshHandle: ReturnType<typeof setInterval> | null = null;

  readonly isAdmin = computed(() => this.auth.user()?.user_metadata?.role === 'admin');

  readonly logs = signal<AdminAttendanceLogRow[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  constructor() {
    this.load();
    this.refreshHandle = setInterval(() => this.load({ silent: true }), REFRESH_INTERVAL_MS);
  }

  private async load(options: { silent?: boolean } = {}) {
    if (!options.silent) this.loading.set(true);
    try {
      const logs = await this.adminService.getAttendanceLogs();
      this.logs.set(logs);
      this.error.set(null);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Could not load attendance logs.');
    } finally {
      if (!options.silent) this.loading.set(false);
    }
  }

  displayTime(log: AdminAttendanceLogRow): string {
    return log.occurred_at ?? log.created_at;
  }

  wasSyncedLate(log: AdminAttendanceLogRow): boolean {
    if (!log.occurred_at) return false;
    return new Date(log.created_at).getTime() - new Date(log.occurred_at).getTime() > LATE_SYNC_THRESHOLD_MS;
  }

  ngOnDestroy() {
    if (this.refreshHandle !== null) clearInterval(this.refreshHandle);
  }
}
