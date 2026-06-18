export interface AppUser {
  id: string;
  email?: string;
  user_metadata?: { full_name?: string; [key: string]: unknown };
}
