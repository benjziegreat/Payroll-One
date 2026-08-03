import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';
import type { Coordinates } from './geo.service';
import { LocalApiService } from './local-api.service';
import { SupabaseService } from './supabase.service';

const CACHE_KEY = 'payroll_one_office_location_cache';
const ALL_CACHE_KEY = 'payroll_one_office_locations_cache';

export interface AssignedOfficeLocation extends Coordinates {
  id: number;
  name: string;
}

// The office location a user is assigned to (admin-managed — see
// AdminService's office-location CRUD and user-assignment methods).
@Injectable({ providedIn: 'root' })
export class OfficeLocationService {
  private readonly isLocal = environment.backend === 'local';

  constructor(
    private readonly localApi: LocalApiService,
    private readonly supabase: SupabaseService,
  ) {}

  async get(): Promise<AssignedOfficeLocation | null> {
    try {
      const location = await this.fetch();
      if (location) localStorage.setItem(CACHE_KEY, JSON.stringify(location));
      return location;
    } catch (err) {
      // Offline — fall back to whatever office location we last saw, so the
      // geofence check still has something to measure against.
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) return JSON.parse(cached) as AssignedOfficeLocation;
      throw err;
    }
  }

  /** Every office location that has coordinates set — lets a caller assigned to "All locations" (get() resolves to null) work out which branch is nearest to them. */
  async getAll(): Promise<AssignedOfficeLocation[]> {
    try {
      const locations = await this.fetchAll();
      localStorage.setItem(ALL_CACHE_KEY, JSON.stringify(locations));
      return locations;
    } catch (err) {
      const cached = localStorage.getItem(ALL_CACHE_KEY);
      if (cached) return JSON.parse(cached) as AssignedOfficeLocation[];
      throw err;
    }
  }

  private async fetchAll(): Promise<AssignedOfficeLocation[]> {
    if (this.isLocal) {
      const { locations } = await this.localApi.request<{ locations: AssignedOfficeLocation[] }>(
        '/settings/office-locations',
        { method: 'GET' },
      );
      return locations;
    }

    // Multi-location admin management is local-backend only for now (see
    // fetch() below) — on Supabase there's just the single legacy location.
    const single = await this.fetch();
    return single ? [single] : [];
  }

  private async fetch(): Promise<AssignedOfficeLocation | null> {
    if (this.isLocal) {
      const { location } = await this.localApi.request<{
        location: AssignedOfficeLocation | null;
      }>('/settings/office-location', { method: 'GET' });
      return location;
    }

    // Multi-location admin management is local-backend only for now; on
    // Supabase everyone still shares the single legacy office_location row.
    const { data, error } = await this.supabase.client
      .from('office_location')
      .select('latitude, longitude')
      .eq('id', 1)
      .maybeSingle();
    if (error) throw error;
    return data ? { id: 1, name: 'Main Office', ...(data as Coordinates) } : null;
  }
}
