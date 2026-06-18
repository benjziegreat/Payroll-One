import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { AttendanceService, type AttendanceLog } from '../../core/attendance.service';
import { AuthService } from '../../core/auth.service';

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

  constructor() {
    this.load();
  }

  private async load() {
    const user = this.auth.user();
    if (!user) return;
    this.logs.set(await this.attendanceService.getHistory(user.id, 100));
    this.loading.set(false);
  }
}
