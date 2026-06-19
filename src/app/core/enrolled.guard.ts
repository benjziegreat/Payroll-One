import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { AuthService } from './auth.service';
import { FaceService } from './face.service';
import { WebauthnService } from './webauthn.service';

export const enrolledGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const faceService = inject(FaceService);
  const webauthnService = inject(WebauthnService);

  await auth.readyPromise;
  const user = auth.user();
  if (!user) return router.createUrlTree(['/auth']);

  try {
    const [faceEnrolled, fingerprintEnrolled] = await Promise.all([
      faceService.isEnrolled(user.id),
      webauthnService.isEnrolled(user.id),
    ]);
    if (faceEnrolled || fingerprintEnrolled) return true;
    return router.createUrlTree(['/enroll']);
  } catch {
    // Offline with no cached enrollment status at all (very first run with
    // no connectivity yet) — let them through rather than stranding the
    // navigation; the dashboard degrades gracefully if nothing's enrolled.
    return true;
  }
};
