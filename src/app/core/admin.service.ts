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
  lastAction: AttendanceAction | null;
  lastSeenAt: string | null;
  distanceMeters: number | null;
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
