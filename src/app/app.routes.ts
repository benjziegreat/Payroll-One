import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './core/auth.guard';
import { enrolledGuard } from './core/enrolled.guard';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
  {
    path: 'auth',
    canActivate: [guestGuard],
    loadComponent: () => import('./pages/auth/auth.page').then((m) => m.AuthPage),
  },
  {
    path: 'enroll',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/enroll/enroll.page').then((m) => m.EnrollPage),
  },
  {
    path: 'dashboard',
    canActivate: [authGuard, enrolledGuard],
    loadComponent: () => import('./pages/dashboard/dashboard.page').then((m) => m.DashboardPage),
  },
  {
    path: 'history',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/history/history.page').then((m) => m.HistoryPage),
  },
  { path: '**', redirectTo: 'dashboard' },
];
