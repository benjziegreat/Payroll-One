import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';
import { LocalApiService } from './local-api.service';
import { SupabaseService } from './supabase.service';

const MODEL_URL = '/models';
const MATCH_THRESHOLD = 0.55;

@Injectable({ providedIn: 'root' })
export class FaceService {
  private faceapi: typeof import('face-api.js') | null = null;
  private modelsLoaded = false;
  private readonly isLocal = environment.backend === 'local';

  constructor(
    private readonly supabase: SupabaseService,
    private readonly localApi: LocalApiService,
  ) {}

  private async ensureModelsLoaded() {
    if (this.modelsLoaded) return;
    this.faceapi = await import('face-api.js');
    await Promise.all([
      this.faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      this.faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      this.faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
    ]);
    this.modelsLoaded = true;
  }

  async startCamera(video: HTMLVideoElement): Promise<MediaStream> {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user' },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
    return stream;
  }

  static stopCamera(stream: MediaStream | null) {
    stream?.getTracks().forEach((track) => track.stop());
  }

  async captureDescriptor(video: HTMLVideoElement): Promise<Float32Array | null> {
    await this.ensureModelsLoaded();
    const faceapi = this.faceapi!;
    const result = await faceapi
      .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions())
      .withFaceLandmarks()
      .withFaceDescriptor();
    return result?.descriptor ?? null;
  }

  async saveEnrollment(userId: string, descriptor: Float32Array) {
    if (this.isLocal) {
      await this.localApi.request('/face/enroll', { body: { descriptor: Array.from(descriptor) } });
      return;
    }

    const { error } = await this.supabase.client
      .from('face_enrollments')
      .upsert({ user_id: userId, descriptor: Array.from(descriptor) });
    if (error) throw error;
  }

  async isEnrolled(userId: string): Promise<boolean> {
    if (this.isLocal) {
      const { enrolled } = await this.localApi.request<{ enrolled: boolean }>('/face/status', {
        method: 'GET',
      });
      return enrolled;
    }

    const { data, error } = await this.supabase.client
      .from('face_enrollments')
      .select('user_id')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    return !!data;
  }

  async verifyAgainstEnrollment(userId: string, liveDescriptor: Float32Array): Promise<boolean> {
    await this.ensureModelsLoaded();

    if (this.isLocal) {
      const { matched } = await this.localApi.request<{ matched: boolean }>('/face/verify', {
        body: { descriptor: Array.from(liveDescriptor) },
      });
      return matched;
    }

    const { data, error } = await this.supabase.client
      .from('face_enrollments')
      .select('descriptor')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return false;

    const enrolled = new Float32Array(data.descriptor as number[]);
    const distance = this.faceapi!.euclideanDistance(enrolled, liveDescriptor);
    return distance <= MATCH_THRESHOLD;
  }
}
