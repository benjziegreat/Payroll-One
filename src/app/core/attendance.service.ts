import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';
import type { Coordinates } from './geo.service';
import { LocalApiService } from './local-api.service';
import { SupabaseService } from './supabase.service';

export type AttendanceAction = 'login' | 'logout';
export type BiometricMethod = 'face' | 'fingerprint';

export interface AttendanceLog {
  id: string;
  user_id: string;
  action: AttendanceAction;
  method: BiometricMethod;
  selfie_url?: string | null;
  occurred_at?: string | null;
  created_at: string;
}

export interface LogEventOptions {
  /** When the action actually happened on the device (e.g. captured while offline). */
  occurredAt?: string;
  /** Idempotency key so a retried offline sync can't double-insert. */
  clientEventId?: string;
  /** For "All locations" users: which branch they said they're at, checked against instead of an automatic nearest-office guess. Ignored server-side for users with a fixed office assignment. */
  officeLocationId?: number;
  /**
   * True only for OfflineQueueService's deferred retry of an already-queued
   * entry — never for the initial live attempt. Tells the server to trust
   * the coordinates captured at the time rather than re-running the
   * geofence check against them now: that check already ran (or was
   * unreachable) at capture time, and re-validating stale coordinates later
   * only adds a way for ordinary GPS drift to permanently strand a
   * legitimate offline clock-in/out that can never be retried into passing.
   */
  offlineSync?: boolean;
}

@Injectable({ providedIn: 'root' })
export class AttendanceService {
  private readonly isLocal = environment.backend === 'local';

  constructor(
    private readonly supabase: SupabaseService,
    private readonly localApi: LocalApiService,
  ) {}

  async logEvent(
    userId: string,
    action: AttendanceAction,
    method: BiometricMethod,
    location?: Coordinates,
    options?: LogEventOptions,
  ) {
    if (this.isLocal) {
      await this.localApi.request('/attendance', {
        body: {
          action,
          method,
          ...location,
          occurredAt: options?.occurredAt,
          clientEventId: options?.clientEventId,
          offlineSync: options?.offlineSync,
          officeLocationId: options?.officeLocationId,
        },
      });
      return;
    }

    // occurredAt/clientEventId aren't supported by the Supabase schema yet —
    // offline queuing still works, just without offline-sync dedupe/accurate timestamps.
    const { error } = await this.supabase.client
      .from('attendance_logs')
      .insert({ user_id: userId, action, method, ...location });
    if (error) throw error;
  }

  async getHistory(userId: string, limit = 50): Promise<AttendanceLog[]> {
    const cacheKey = `payroll_one_history_cache_${userId}`;
    try {
      let logs: AttendanceLog[];
      if (this.isLocal) {
        ({ logs } = await this.localApi.request<{ logs: AttendanceLog[] }>(
          `/attendance?limit=${limit}`,
          { method: 'GET' },
        ));
      } else {
        const { data, error } = await this.supabase.client
          .from('attendance_logs')
          .select('*')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(limit);
        if (error) throw error;
        logs = data as AttendanceLog[];
      }
      localStorage.setItem(cacheKey, JSON.stringify(logs));
      return logs;
    } catch (err) {
      // Offline — fall back to the last-fetched DTR history rather than
      // leaving the History page with nothing to show at all.
      const cached = localStorage.getItem(cacheKey);
      if (cached) return JSON.parse(cached) as AttendanceLog[];
      throw err;
    }
  }

  async getLastAction(userId: string): Promise<AttendanceAction | null> {
    if (this.isLocal) {
      const { action } = await this.localApi.request<{ action: AttendanceAction | null }>(
        '/attendance/last',
        { method: 'GET' },
      );
      return action;
    }

    const { data, error } = await this.supabase.client
      .from('attendance_logs')
      .select('action')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return (data?.action as AttendanceAction) ?? null;
  }
}
