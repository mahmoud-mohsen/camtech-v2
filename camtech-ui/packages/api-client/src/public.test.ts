import { describe, expect, it } from 'vitest';
import { CamtechPublicClient } from './public';

describe('CamtechPublicClient selfie flows', () => {
  const jpeg = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' });
  const recording = () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const client = new CamtechPublicClient({
      baseUrl: 'https://api.example/camtech-service/', auth: { sdkToken: 'tok' },
      transport: async (url, init) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ sessionId: 's1', decision: 'APPROVED', reasonCode: null, message: null, resultToken: 't', resultTokenExpiresAt: null }));
      },
    });
    return { client, calls };
  };
  const form = (init: RequestInit) => init.body as FormData;

  it('sends a liveness check with or without a subject, with the challenge frames', async () => {
    const { client, calls } = recording();
    await expect(client.livenessCheck(null, jpeg(), null, undefined, undefined, { challengeId: 'c1', frames: [jpeg(), jpeg()] }))
      .resolves.toMatchObject({ decision: 'APPROVED' });
    expect(calls[0].url).toBe('https://api.example/camtech-service/v2/liveness-checks');
    expect(calls[0].init.method).toBe('POST');
    const f = form(calls[0].init);
    expect(f.has('subjectRef')).toBe(false);
    expect(f.has('closer')).toBe(false);
    expect(f.get('challengeId')).toBe('c1');
    expect(f.getAll('challengeFrames')).toHaveLength(2);
    await client.livenessCheck('u1', jpeg(), null, 0.9);
    expect(form(calls[1].init).get('subjectRef')).toBe('u1');
    expect(form(calls[1].init).get('deviceAntispoofScore')).toBe('0.9');
    expect(form(calls[1].init).has('challengeId')).toBe(false);
  });

  it('sends a face enrollment and a face authentication for the subject', async () => {
    const { client, calls } = recording();
    await client.faceEnroll('u1', jpeg(), null, undefined, undefined, { challengeId: 'c2', frames: [jpeg()] });
    expect(calls[0].url).toBe('https://api.example/camtech-service/v2/face-enrollments');
    expect(form(calls[0].init).get('subjectRef')).toBe('u1');
    expect(form(calls[0].init).get('normal')).toBeInstanceOf(Blob);
    await client.faceAuthenticate('u1', jpeg(), jpeg());
    expect(calls[1].url).toBe('https://api.example/camtech-service/v2/face-authentications');
    expect(form(calls[1].init).has('closer')).toBe(true);
  });

  it('sends enrollFace only when given and the challenge flow', async () => {
    const { client, calls } = recording();
    await client.startSelfieVerification({ subjectRef: 'u1', enrollFace: false });
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ subjectRef: 'u1', enrollFace: false });
    await client.startSelfieVerification({ subjectRef: 'u1' });
    expect(JSON.parse(calls[1].init.body as string)).toEqual({ subjectRef: 'u1' });
    await client.createLivenessChallenge({ flow: 'LIVENESS_CHECK' });
    expect(calls[2].url).toBe('https://api.example/camtech-service/v2/liveness-challenges');
    expect(JSON.parse(calls[2].init.body as string)).toEqual({ flow: 'LIVENESS_CHECK' });
  });
});
