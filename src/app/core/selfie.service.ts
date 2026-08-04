import { Injectable } from '@angular/core';
import { LocalApiService } from './local-api.service';

const EXTENSION_BY_TYPE: Record<string, string> = {
  'video/webm': '.webm',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
};

function fileFor(blob: Blob): File {
  // blob.type from MediaRecorder is typically e.g. "video/webm;codecs=vp8,opus" — strip
  // the codecs parameter before looking up an extension (cosmetic only; the server
  // re-derives the real extension from the same base type on its own).
  const baseType = blob.type.split(';')[0].trim();
  const extension = EXTENSION_BY_TYPE[baseType] ?? '.webm';
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
      'PATCH',
    );
    return selfieUrl;
  }

  async uploadForKiosk(clientEventId: string, blob: Blob): Promise<string> {
    const { selfieUrl } = await this.localApi.uploadFile<{ selfieUrl: string }>(
      `/kiosk/${clientEventId}/selfie`,
      'selfie',
      fileFor(blob),
      'PATCH',
    );
    return selfieUrl;
  }
}
