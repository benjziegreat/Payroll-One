export type UserRole = 'employee' | 'admin';

export interface AppUser {
  id: string;
  email?: string;
  user_metadata?: {
    full_name?: string;
    role?: UserRole;
    photo_url?: string | null;
    require_selfie_verification?: boolean;
    [key: string]: unknown;
  };
}
