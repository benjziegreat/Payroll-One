import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { AdminService, type AdminUserRow } from '../../core/admin.service';
import { GeoService } from '../../core/geo.service';
import { UserAvatarComponent } from '../../shared/user-avatar/user-avatar.component';

const GEOFENCE_MAX_RADIUS_METERS = 10;

@Component({
  selector: 'app-admin-users-page',
  imports: [DatePipe, UserAvatarComponent],
  templateUrl: './admin-users.page.html',
  styleUrl: './admin-users.page.scss',
})
export class AdminUsersPage {
  private readonly adminService = inject(AdminService);

  readonly geofenceMaxLabel = GeoService.formatDistance(GEOFENCE_MAX_RADIUS_METERS);

  readonly users = signal<AdminUserRow[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly pendingId = signal<string | null>(null);

  constructor() {
    this.load();
  }

  private async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.users.set(await this.adminService.getUsers());
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Could not load users.');
    } finally {
      this.loading.set(false);
    }
  }

  distanceLabel(user: AdminUserRow): string {
    return user.distanceMeters === null
      ? 'No location data'
      : `${GeoService.formatDistance(user.distanceMeters)} from office`;
  }

  isOverLimit(user: AdminUserRow): boolean {
    return user.distanceMeters !== null && user.distanceMeters > GEOFENCE_MAX_RADIUS_METERS;
  }

  async toggleBypass(user: AdminUserRow) {
    this.pendingId.set(user.id);
    this.error.set(null);
    const next = !user.bypassGeofence;
    try {
      await this.adminService.setBypassGeofence(user.id, next);
      this.users.update((list) =>
        list.map((u) => (u.id === user.id ? { ...u, bypassGeofence: next } : u)),
      );
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Could not update user.');
    } finally {
      this.pendingId.set(null);
    }
  }
}
