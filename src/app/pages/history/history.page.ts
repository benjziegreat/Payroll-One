import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { AttendanceService, type AttendanceLog } from '../../core/attendance.service';
import { AuthService } from '../../core/auth.service';

const LATE_SYNC_THRESHOLD_MS = 60_000;

@Component({
  selector: 'app-history-page',
  imports: [DatePipe],
  templateUrl: './history.page.html',
  styleUrl: './history.page.scss',
})
export class HistoryPage {
  private readonly auth = inject(AuthService);
  private readonly attendanceService = inject(AttendanceService);

  readonly logs = signal<AttendanceLog[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  constructor() {
    this.load();
  }

  private async load() {
    const user = this.auth.user();
    if (!user) return;
    try {
      this.logs.set(await this.attendanceService.getHistory(user.id, 100));
      this.error.set(null);
    } catch (err) {
      this.error.set(
        err instanceof Error ? err.message : "Couldn't load history — check your connection.",
      );
    } finally {
      this.loading.set(false);
    }
  }

  displayTime(log: AttendanceLog): string {
    return log.occurred_at ?? log.created_at;
  }

  wasSyncedLate(log: AttendanceLog): boolean {
    if (!log.occurred_at) return false;
    return new Date(log.created_at).getTime() - new Date(log.occurred_at).getTime() > LATE_SYNC_THRESHOLD_MS;
  }
}
