import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';
import type { Coordinates } from './geo.service';
import { LocalApiService } from './local-api.service';
import { SupabaseService } from './supabase.service';

const CACHE_KEY = 'payroll_one_office_location_cache';

@Injectable({ providedIn: 'root' })
export class OfficeLocationService {
  private readonly isLocal = environment.backend === 'local';

  constructor(
    private readonly localApi: LocalApiService,
    private readonly supabase: SupabaseService,
  ) {}

  async get(): Promise<Coordinates | null> {
    try {
      const location = await this.fetch();
      if (location) localStorage.setItem(CACHE_KEY, JSON.stringify(location));
      return location;
    } catch (err) {
      // Offline — fall back to whatever office location we last saw, so the
      // geofence check still has something to measure against.
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) return JSON.parse(cached) as Coordinates;
      throw err;
    }
  }

  private async fetch(): Promise<Coordinates | null> {
    if (this.isLocal) {
      const { location } = await this.localApi.request<{ location: Coordinates | null }>(
        '/settings/office-location',
        { method: 'GET' },
      );
      return location;
    }

    const { data, error } = await this.supabase.client
      .from('office_location')
      .select('latitude, longitude')
      .eq('id', 1)
      .maybeSingle();
    if (error) throw error;
    return data as Coordinates | null;
  }

  async set(location: Coordinates): Promise<void> {
    if (this.isLocal) {
      await this.localApi.request('/settings/office-location', { body: location });
    } else {
      const { error } = await this.supabase.client
        .from('office_location')
        .upsert({ id: 1, ...location });
      if (error) throw error;
    }
    localStorage.setItem(CACHE_KEY, JSON.stringify(location));
  }
}
