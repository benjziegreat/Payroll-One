import { Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';

export type AttendanceAction = 'login' | 'logout';
export type BiometricMethod = 'face' | 'fingerprint';

export interface AttendanceLog {
  id: string;
  user_id: string;
  action: AttendanceAction;
  method: BiometricMethod;
  created_at: string;
}

@Injectable({ providedIn: 'root' })
export class AttendanceService {
  constructor(private readonly supabase: SupabaseService) {}

  async logEvent(userId: string, action: AttendanceAction, method: BiometricMethod) {
    const { error } = await this.supabase.client
      .from('attendance_logs')
      .insert({ user_id: userId, action, method });
    if (error) throw error;
  }

  async getHistory(userId: string, limit = 50): Promise<AttendanceLog[]> {
    const { data, error } = await this.supabase.client
      .from('attendance_logs')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data as AttendanceLog[];
  }

  async getLastAction(userId: string): Promise<AttendanceAction | null> {
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
