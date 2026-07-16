import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AdminService, type AdminOfficeLocationRow } from '../../core/admin.service';
import { GeoService } from '../../core/geo.service';

interface LocationForm {
  name: string;
  latitude: string;
  longitude: string;
}

const EMPTY_FORM: LocationForm = { name: '', latitude: '', longitude: '' };

@Component({
  selector: 'app-admin-locations-page',
  imports: [FormsModule],
  templateUrl: './admin-locations.page.html',
  styleUrl: './admin-locations.page.scss',
})
export class AdminLocationsPage {
  private readonly adminService = inject(AdminService);
  private readonly geoService = inject(GeoService);

  readonly locations = signal<AdminOfficeLocationRow[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly pendingId = signal<number | 'new' | null>(null);

  readonly creating = signal(false);
  readonly createForm = signal<LocationForm>({ ...EMPTY_FORM });

  readonly editingId = signal<number | null>(null);
  readonly editForm = signal<LocationForm>({ ...EMPTY_FORM });

  constructor() {
    this.load();
  }

  private async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.locations.set(await this.adminService.getOfficeLocations());
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Could not load office locations.');
    } finally {
      this.loading.set(false);
    }
  }

  coordsLabel(location: AdminOfficeLocationRow): string {
    if (location.latitude === null || location.longitude === null) return 'Not set';
    return `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}`;
  }

  startCreate() {
    this.error.set(null);
    this.createForm.set({ ...EMPTY_FORM });
    this.creating.set(true);
  }

  cancelCreate() {
    this.creating.set(false);
  }

  async useCurrentLocationFor(target: 'create' | 'edit') {
    this.error.set(null);
    try {
      const coords = await this.geoService.getCurrentPosition();
      const form = target === 'create' ? this.createForm : this.editForm;
      form.update((f) => ({
        ...f,
        latitude: String(coords.latitude),
        longitude: String(coords.longitude),
      }));
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Could not read your current location.');
    }
  }

  async submitCreate() {
    const form = this.createForm();
    if (!form.name.trim()) {
      this.error.set('Name is required.');
      return;
    }
    const coords = this.parseCoords(form);
    if (coords === 'invalid') {
      this.error.set('Latitude and longitude must both be set, or both left blank.');
      return;
    }

    this.pendingId.set('new');
    this.error.set(null);
    try {
      await this.adminService.createOfficeLocation(form.name.trim(), coords ?? undefined);
      this.creating.set(false);
      await this.load();
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Could not create office location.');
    } finally {
      this.pendingId.set(null);
    }
  }

  startEdit(location: AdminOfficeLocationRow) {
    this.error.set(null);
    this.editForm.set({
      name: location.name,
      latitude: location.latitude === null ? '' : String(location.latitude),
      longitude: location.longitude === null ? '' : String(location.longitude),
    });
    this.editingId.set(location.id);
  }

  cancelEdit() {
    this.editingId.set(null);
  }

  async submitEdit(id: number) {
    const form = this.editForm();
    if (!form.name.trim()) {
      this.error.set('Name is required.');
      return;
    }
    const coords = this.parseCoords(form);
    if (coords === 'invalid') {
      this.error.set('Latitude and longitude must both be set, or both left blank.');
      return;
    }

    this.pendingId.set(id);
    this.error.set(null);
    try {
      await this.adminService.updateOfficeLocation(id, {
        name: form.name.trim(),
        ...(coords ?? {}),
      });
      this.editingId.set(null);
      await this.load();
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Could not update office location.');
    } finally {
      this.pendingId.set(null);
    }
  }

  async remove(location: AdminOfficeLocationRow) {
    this.pendingId.set(location.id);
    this.error.set(null);
    try {
      await this.adminService.deleteOfficeLocation(location.id);
      this.locations.update((list) => list.filter((l) => l.id !== location.id));
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Could not delete office location.');
    } finally {
      this.pendingId.set(null);
    }
  }

  private parseCoords(
    form: LocationForm,
  ): { latitude: number; longitude: number } | null | 'invalid' {
    const lat = form.latitude.trim();
    const lng = form.longitude.trim();
    if (!lat && !lng) return null;
    if (!lat || !lng) return 'invalid';
    const latitude = Number(lat);
    const longitude = Number(lng);
    if (Number.isNaN(latitude) || Number.isNaN(longitude)) return 'invalid';
    return { latitude, longitude };
  }
}
