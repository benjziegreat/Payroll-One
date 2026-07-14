import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { AuthService } from './auth.service';
import { FaceService } from './face.service';

export const enrolledGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const faceService = inject(FaceService);

  await auth.readyPromise;
  const user = auth.user();
  if (!user) return router.createUrlTree(['/auth']);

  try {
    const faceEnrolled = await faceService.isEnrolled(user.id);
    if (faceEnrolled) return true;
    return router.createUrlTree(['/enroll']);
  } catch {
    // Offline with no cached enrollment status at all (very first run with
    // no connectivity yet) — let them through rather than stranding the
    // navigation; the dashboard degrades gracefully if nothing's enrolled.
    return true;
  }
};
