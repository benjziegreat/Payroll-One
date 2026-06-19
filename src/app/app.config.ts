import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { provideServiceWorker } from '@angular/service-worker';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    // This app is always built with `ng build --configuration development`
    // (see `build:local` in package.json) even for real usage, so the
    // standard `!isDevMode()` gate would leave the service worker (and the
    // offline support it provides) permanently disabled. Enable it
    // unconditionally instead.
    provideServiceWorker('ngsw-worker.js', {
      enabled: true,
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};
