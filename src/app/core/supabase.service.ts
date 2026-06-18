import { Injectable } from '@angular/core';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class SupabaseService {
  private _client: SupabaseClient | null = null;

  // Lazy: only constructed on first access, so 'local' backend mode never
  // touches the placeholder Supabase URL/key and can't throw at startup.
  get client(): SupabaseClient {
    if (!this._client) {
      this._client = createClient(environment.supabaseUrl, environment.supabaseAnonKey);
    }
    return this._client;
  }
}
