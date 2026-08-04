import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  AdminService,
  type AdminOfficeLocationRow,
  type AdminUserRow,
} from '../../core/admin.service';
import { GeoService } from '../../core/geo.service';
import { UserAvatarComponent } from '../../shared/user-avatar/user-avatar.component';

const GEOFENCE_MAX_RADIUS_METERS = 10;

@Component({
  selector: 'app-admin-users-page',
  imports: [DatePipe, FormsModule, UserAvatarComponent],
  templateUrl: './admin-users.page.html',
  styleUrl: './admin-users.page.scss',
})
export class AdminUsersPage {
  private readonly adminService = inject(AdminService);

  readonly geofenceMaxLabel = GeoService.formatDistance(GEOFENCE_MAX_RADIUS_METERS);

  readonly users = signal<AdminUserRow[]>([]);
  readonly officeLocations = signal<AdminOfficeLocationRow[]>([]);
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
      const [users, officeLocations] = await Promise.all([
        this.adminService.getUsers(),
        this.adminService.getOfficeLocations(),
      ]);
      this.users.set(users);
      this.officeLocations.set(officeLocations);
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

  async toggleRequireSelfie(user: AdminUserRow) {
    this.pendingId.set(user.id);
    this.error.set(null);
    const next = !user.requireSelfieVerification;
    try {
      await this.adminService.setRequireSelfieVerification(user.id, next);
      this.users.update((list) =>
        list.map((u) => (u.id === user.id ? { ...u, requireSelfieVerification: next } : u)),
      );
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Could not update user.');
    } finally {
      this.pendingId.set(null);
    }
  }

  async assignOfficeLocation(user: AdminUserRow, officeLocationId: string) {
    const id = officeLocationId === '' ? null : Number(officeLocationId);
    if (id === user.officeLocationId) return;

    this.pendingId.set(user.id);
    this.error.set(null);
    try {
      await this.adminService.setUserOfficeLocation(user.id, id);
      const officeLocationName =
        id === null ? null : this.officeLocations().find((l) => l.id === id)?.name ?? null;
      this.users.update((list) =>
        list.map((u) =>
          u.id === user.id ? { ...u, officeLocationId: id, officeLocationName } : u,
        ),
      );
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Could not reassign office location.');
    } finally {
      this.pendingId.set(null);
    }
  }
}
