import { randomUUID } from 'node:crypto';
import { test, expect, type APIRequestContext } from '@playwright/test';

// Exercises local-server's selfie-attach endpoint directly over HTTP, the
// same way SelfieService does client-side. This is API-level rather than
// browser-driven because the real UI path is gated behind a live biometric
// match (face-api against an enrolled descriptor, or a WebAuthn fingerprint
// assertion) that a headless browser can't produce.
test.describe('PATCH /api/local/attendance/:clientEventId/selfie', () => {
  let token: string;

  test.beforeAll(async ({ request }) => {
    const signup = await request.post('/api/local/auth/signup', {
      data: {
        email: `e2e-selfie-${Date.now()}@example.test`,
        password: 'e2e-test-pass-123',
        fullName: 'E2E Selfie Test',
      },
    });
    expect(signup.ok()).toBeTruthy();
    token = (await signup.json()).token;
  });

  async function createAttendanceLog(request: APIRequestContext): Promise<string> {
    const clientEventId = randomUUID();
    const res = await request.post('/api/local/attendance', {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        action: 'login',
        method: 'face',
        occurredAt: new Date().toISOString(),
        clientEventId,
        // Skips the geofence check (same as a deferred offline-queue retry) —
        // this test is about the selfie-attach endpoint, not location.
        offlineSync: true,
      },
    });
    expect(res.ok()).toBeTruthy();
    return clientEventId;
  }

  test('accepts a video/webm selfie and serves it back', async ({ request }) => {
    const clientEventId = await createAttendanceLog(request);

    const res = await request.patch(`/api/local/attendance/${clientEventId}/selfie`, {
      headers: { Authorization: `Bearer ${token}` },
      multipart: {
        selfie: {
          name: 'selfie.webm',
          mimeType: 'video/webm',
          buffer: Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]),
        },
      },
    });

    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.selfieUrl).toMatch(/^\/uploads\/selfies\/.+\.webm$/);

    const served = await request.get(body.selfieUrl);
    expect(served.status()).toBe(200);
    expect(served.headers()['content-type']).toBe('video/webm');
  });

  test('is idempotent — resending after attach returns the existing url without overwriting', async ({
    request,
  }) => {
    const clientEventId = await createAttendanceLog(request);
    const attach = (buffer: Buffer) =>
      request.patch(`/api/local/attendance/${clientEventId}/selfie`, {
        headers: { Authorization: `Bearer ${token}` },
        multipart: { selfie: { name: 'selfie.webm', mimeType: 'video/webm', buffer } },
      });

    const first = await attach(Buffer.from([1, 2, 3]));
    const firstUrl = (await first.json()).selfieUrl;

    const second = await attach(Buffer.from([4, 5, 6]));
    expect(second.status()).toBe(200);
    expect((await second.json()).selfieUrl).toBe(firstUrl);
  });

  test('rejects a non-video mimetype — regression guard for the corrupted-blob failure mode', async ({
    request,
  }) => {
    // This is exactly the shape of the real-world bug: Safari resets a cached
    // Blob's .type to "text/plain" after an IndexedDB round trip, so a queued
    // offline selfie would hit this endpoint with the right bytes but the
    // wrong mimetype. The server is right to reject it — the client-side fix
    // is to never let that mimetype reach here in the first place.
    const clientEventId = await createAttendanceLog(request);

    const res = await request.patch(`/api/local/attendance/${clientEventId}/selfie`, {
      headers: { Authorization: `Bearer ${token}` },
      multipart: {
        selfie: { name: 'selfie.webm', mimeType: 'text/plain', buffer: Buffer.from('not a video') },
      },
    });

    expect(res.status()).toBe(400);
    expect((await res.json()).error).toMatch(/WebM, MP4, or QuickTime/);
  });

  test('404s when the attendance log does not exist yet', async ({ request }) => {
    const res = await request.patch(`/api/local/attendance/${randomUUID()}/selfie`, {
      headers: { Authorization: `Bearer ${token}` },
      multipart: {
        selfie: { name: 'selfie.webm', mimeType: 'video/webm', buffer: Buffer.from([1]) },
      },
    });
    expect(res.status()).toBe(404);
  });

  test('requires auth', async ({ request }) => {
    const res = await request.patch(`/api/local/attendance/${randomUUID()}/selfie`, {
      multipart: {
        selfie: { name: 'selfie.webm', mimeType: 'video/webm', buffer: Buffer.from([1]) },
      },
    });
    expect(res.status()).toBe(401);
  });
});
