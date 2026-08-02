import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';
import { LocalApiService } from './local-api.service';
import type { AttendanceAction, BiometricMethod } from './attendance.service';
import type { UserRole } from './types';

export interface AdminUserRow {
  id: string;
  fullName: string;
  email: string;
  role: UserRole;
  bypassGeofence: boolean;
  photoUrl: string | null;
  officeLocationId: number | null;
  officeLocationName: string | null;
  lastAction: AttendanceAction | null;
  lastSeenAt: string | null;
  distanceMeters: number | null;
}

export interface AdminOfficeLocationRow {
  id: number;
  name: string;
  latitude: number | null;
  longitude: number | null;
  employeeCount: number;
}

export interface AdminAttendanceLogRow {
  user_id: string | null;
  full_name: string | null;
  photo_url: string | null;
  action: AttendanceAction;
  method: BiometricMethod;
  occurred_at: string | null;
  created_at: string;
}

@Injectable({ providedIn: 'root' })
export class AdminService {
  private readonly isLocal = environment.backend === 'local';

  constructor(private readonly localApi: LocalApiService) {}

  async getUsers(): Promise<AdminUserRow[]> {
    this.assertLocal();
    const { users } = await this.localApi.request<{ users: AdminUserRow[] }>('/admin/users', {
      method: 'GET',
    });
    return users;
  }

  async setBypassGeofence(userId: string, bypassGeofence: boolean): Promise<void> {
    this.assertLocal();
    await this.localApi.request(`/admin/users/${userId}/bypass-geofence`, {
      method: 'PATCH',
      body: { bypassGeofence },
    });
  }

  async setUserOfficeLocation(userId: string, officeLocationId: number | null): Promise<void> {
    this.assertLocal();
    await this.localApi.request(`/admin/users/${userId}/office-location`, {
      method: 'PATCH',
      body: { officeLocationId },
    });
  }

  async getOfficeLocations(): Promise<AdminOfficeLocationRow[]> {
    this.assertLocal();
    const { locations } = await this.localApi.request<{ locations: AdminOfficeLocationRow[] }>(
      '/admin/office-locations',
      { method: 'GET' },
    );
    return locations;
  }

  async createOfficeLocation(
    name: string,
    coords?: { latitude: number; longitude: number },
  ): Promise<number> {
    this.assertLocal();
    const { id } = await this.localApi.request<{ id: number }>('/admin/office-locations', {
      body: { name, ...coords },
    });
    return id;
  }

  async updateOfficeLocation(
    id: number,
    changes: { name?: string; latitude?: number; longitude?: number },
  ): Promise<void> {
    this.assertLocal();
    await this.localApi.request(`/admin/office-locations/${id}`, {
      method: 'PATCH',
      body: changes,
    });
  }

  async deleteOfficeLocation(id: number): Promise<void> {
    this.assertLocal();
    await this.localApi.request(`/admin/office-locations/${id}`, { method: 'DELETE' });
  }

  async getAttendanceLogs(limit = 200): Promise<AdminAttendanceLogRow[]> {
    this.assertLocal();
    const { logs } = await this.localApi.request<{ logs: AdminAttendanceLogRow[] }>(
      `/admin/attendance-logs?limit=${limit}`,
      { method: 'GET' },
    );
    return logs;
  }

  private assertLocal() {
    if (!this.isLocal) {
      throw new Error('Admin features are only available on the local backend.');
    }
  }
}
