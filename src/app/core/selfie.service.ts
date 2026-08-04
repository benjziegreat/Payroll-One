import { Injectable } from '@angular/core';
import { LocalApiService } from './local-api.service';

const EXTENSION_BY_TYPE: Record<string, string> = {
  'video/webm': '.webm',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
};

function fileFor(blob: Blob, mimeType?: string): File {
  // `mimeType`, when given, is the type captured at recording time rather
  // than read off the Blob directly. Safari resets a Blob's .type to
  // "text/plain" after it round-trips through IndexedDB (used to cache
  // selfies recorded while offline), so trusting blob.type for a queued
  // upload silently corrupts every one of them into a rejected upload.
  //
  // The type is typically e.g. "video/webm;codecs=vp8,opus" — strip the
  // codecs parameter before looking up an extension (cosmetic only; the
  // server re-derives the real extension from the same base type on its own).
  const type = mimeType || blob.type;
  const baseType = type.split(';')[0].trim();
  const extension = EXTENSION_BY_TYPE[baseType] ?? '.webm';
  return new File([blob], `selfie${extension}`, { type: type || 'video/webm' });
}

/** Uploads a recorded video selfie and attaches it to an already-created attendance log, identified by the same clientEventId the log itself was created with — see local-server/selfie-upload.js. */
@Injectable({ providedIn: 'root' })
export class SelfieService {
  constructor(private readonly localApi: LocalApiService) {}

  async uploadForAttendance(clientEventId: string, blob: Blob, mimeType?: string): Promise<string> {
    const { selfieUrl } = await this.localApi.uploadFile<{ selfieUrl: string }>(
      `/attendance/${clientEventId}/selfie`,
      'selfie',
      fileFor(blob, mimeType),
      'PATCH',
    );
    return selfieUrl;
  }

  async uploadForKiosk(clientEventId: string, blob: Blob, mimeType?: string): Promise<string> {
    const { selfieUrl } = await this.localApi.uploadFile<{ selfieUrl: string }>(
      `/kiosk/${clientEventId}/selfie`,
      'selfie',
      fileFor(blob, mimeType),
      'PATCH',
    );
    return selfieUrl;
  }
}
