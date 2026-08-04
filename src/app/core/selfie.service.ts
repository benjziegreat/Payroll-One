import { Injectable } from '@angular/core';
import { LocalApiService } from './local-api.service';

const EXTENSION_BY_TYPE: Record<string, string> = {
  'video/webm': '.webm',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
};

function fileFor(blob: Blob): File {
  const extension = EXTENSION_BY_TYPE[blob.type] ?? '.webm';
  return new File([blob], `selfie${extension}`, { type: blob.type || 'video/webm' });
}

/** Uploads a recorded video selfie and attaches it to an already-created attendance log, identified by the same clientEventId the log itself was created with — see local-server/selfie-upload.js. */
@Injectable({ providedIn: 'root' })
export class SelfieService {
  constructor(private readonly localApi: LocalApiService) {}

  async uploadForAttendance(clientEventId: string, blob: Blob): Promise<string> {
    const { selfieUrl } = await this.localApi.uploadFile<{ selfieUrl: string }>(
      `/attendance/${clientEventId}/selfie`,
      'selfie',
      fileFor(blob),
    );
    return selfieUrl;
  }

  async uploadForKiosk(clientEventId: string, blob: Blob): Promise<string> {
    const { selfieUrl } = await this.localApi.uploadFile<{ selfieUrl: string }>(
      `/kiosk/${clientEventId}/selfie`,
      'selfie',
      fileFor(blob),
    );
    return selfieUrl;
  }
}
