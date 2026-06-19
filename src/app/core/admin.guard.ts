import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { AuthService } from './auth.service';

export const adminGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.readyPromise;
  const user = auth.user();
  if (!user) return router.createUrlTree(['/auth']);
  return user.user_metadata?.role === 'admin' ? true : router.createUrlTree(['/dashboard']);
};
