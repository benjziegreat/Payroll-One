import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-auth-page',
  imports: [FormsModule],
  templateUrl: './auth.page.html',
  styleUrl: './auth.page.scss',
})
export class AuthPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly mode = signal<'signin' | 'signup'>('signin');
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly info = signal<string | null>(null);

  fullName = '';
  email = '';
  password = '';

  setMode(mode: 'signin' | 'signup') {
    this.mode.set(mode);
    this.error.set(null);
    this.info.set(null);
  }

  async submit() {
    this.error.set(null);
    this.info.set(null);
    this.loading.set(true);
    try {
      if (this.mode() === 'signup') {
        await this.auth.signUp(this.email, this.password, this.fullName);
        if (this.auth.user()) {
          await this.router.navigateByUrl('/enroll');
        } else {
          this.info.set('Account created. Check your email to confirm, then sign in.');
          this.setMode('signin');
        }
      } else {
        await this.auth.signIn(this.email, this.password);
        await this.router.navigateByUrl('/dashboard');
      }
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      this.loading.set(false);
    }
  }
}
