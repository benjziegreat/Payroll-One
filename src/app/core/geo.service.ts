import { Injectable, signal } from '@angular/core';

export interface Coordinates {
  latitude: number;
  longitude: number;
}

@Injectable({ providedIn: 'root' })
export class GeoService {
  readonly position = signal<Coordinates | null>(null);
  readonly error = signal<string | null>(null);

  private watchId: number | null = null;

  watch() {
    if (this.watchId !== null) return;
    if (!navigator.geolocation) {
      this.error.set('Geolocation is not supported on this device.');
      return;
    }
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        this.position.set({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
        this.error.set(null);
      },
      (err) => this.error.set(err.message),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    );
  }

  stopWatching() {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
  }

  getCurrentPosition(): Promise<Coordinates> {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocation is not supported on this device.'));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
        (err) => reject(new Error(err.message)),
        { enableHighAccuracy: true, timeout: 15000 },
      );
    });
  }

  static distanceMeters(a: Coordinates, b: Coordinates): number {
    const R = 6371000;
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const dLat = toRad(b.latitude - a.latitude);
    const dLng = toRad(b.longitude - a.longitude);
    const sinDLat = Math.sin(dLat / 2);
    const sinDLng = Math.sin(dLng / 2);
    const h =
      sinDLat * sinDLat + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * sinDLng * sinDLng;
    return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }

  static formatDistance(meters: number): string {
    if (meters >= 1000) return `${(meters / 1000).toFixed(1)}km`;
    return `${Math.round(meters)}m`;
  }
}
