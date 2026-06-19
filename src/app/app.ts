import { Component, ElementRef, HostListener, computed, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from './core/auth.service';
import { OfflineQueueService } from './core/offline-queue.service';
import { UserAvatarComponent } from './shared/user-avatar/user-avatar.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, UserAvatarComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly auth = inject(AuthService);
  protected readonly offlineQueue = inject(OfflineQueueService);
  private readonly router = inject(Router);
  private readonly elementRef: ElementRef<HTMLElement> = inject(ElementRef);

  protected readonly isAdmin = computed(() => this.auth.user()?.user_metadata?.role === 'admin');
  protected readonly isOnline = this.offlineQueue.effectiveOnline;
  protected readonly forcedOffline = this.offlineQueue.forcedOffline;
  protected readonly fullName = computed(
    () =>
      (this.auth.user()?.user_metadata?.['full_name'] as string | undefined) ??
      this.auth.user()?.email ??
      '',
  );
  protected readonly photoUrl = computed(() => this.auth.user()?.user_metadata?.photo_url ?? null);

  protected readonly menuOpen = signal(false);

  toggleMenu() {
    this.menuOpen.update((open) => !open);
  }

  toggleSync() {
    this.offlineQueue.setForcedOffline(!this.forcedOffline());
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    if (this.menuOpen() && !this.elementRef.nativeElement.contains(event.target as Node)) {
      this.menuOpen.set(false);
    }
  }

  async logout() {
    this.menuOpen.set(false);
    await this.auth.signOut();
    this.router.navigateByUrl('/auth');
  }
}
