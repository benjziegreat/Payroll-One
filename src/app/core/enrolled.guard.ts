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

  const [faceEnrolled, fingerprintEnrolled] = await Promise.all([
    faceService.isEnrolled(user.id),
    webauthnService.isEnrolled(user.id),
  ]);

  if (faceEnrolled || fingerprintEnrolled) return true;
  return router.createUrlTree(['/enroll']);
};
