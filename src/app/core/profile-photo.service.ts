import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';
import { LocalApiService } from './local-api.service';

@Injectable({ providedIn: 'root' })
export class ProfilePhotoService {
  private readonly isLocal = environment.backend === 'local';

  constructor(private readonly localApi: LocalApiService) {}

  async upload(file: File): Promise<string> {
    if (!this.isLocal) {
      throw new Error('Profile photo upload is only available on the local backend.');
    }
    const { photoUrl } = await this.localApi.uploadFile<{ photoUrl: string }>(
      '/account/photo',
      'photo',
      file,
    );
    return photoUrl;
  }
}
