import { describe, expect, it } from 'vitest';
import { CamtechTenantClient } from './tenant';

describe('CamtechTenantClient auth', () => {
  const recording = (token: string | null) => {
    const calls: { url: string; init: RequestInit }[] = [];
    const client = new CamtechTenantClient({
      baseUrl: 'https://api.example/camtech-service',
      token: () => token,
      transport: async (url, init) => {
        calls.push({ url, init });
        return new Response('[]', { status: 200 });
      },
    });
    return { client, calls };
  };
  const headers = (init: RequestInit) => new Headers(init.headers);

  it('sends the bearer token and never a tenant-code header', async () => {
    const { client, calls } = recording('tok-1');
    await client.users();
    expect(calls[0].url).toBe('https://api.example/camtech-service/v2/tenant/users');
    expect(headers(calls[0].init).get('Authorization')).toBe('Bearer tok-1');
    expect(headers(calls[0].init).has('X-Tenant-Code')).toBe(false);
  });

  it('sends no Authorization header when signed out, and follows setTokenSource', async () => {
    const { client, calls } = recording(null);
    await client.info();
    expect(headers(calls[0].init).has('Authorization')).toBe(false);
    client.setTokenSource(() => 'tok-2');
    await client.info();
    expect(headers(calls[1].init).get('Authorization')).toBe('Bearer tok-2');
  });

  it('posts the sign-in and user calls to the right paths', async () => {
    const { client, calls } = recording(null);
    await client.login('owner', 'pw');
    await client.resetUserPassword(7);
    await client.updateUser(7, { role: 'VIEWER' });
    expect(calls.map((c) => `${c.init.method} ${c.url.replace('https://api.example/camtech-service', '')}`)).toEqual([
      'POST /v2/tenant/auth/login', 'POST /v2/tenant/users/7/reset-password', 'PUT /v2/tenant/users/7',
    ]);
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ username: 'owner', password: 'pw' });
    expect(JSON.parse(calls[1].init.body as string)).toEqual({ password: null });
  });

  it('calls the documents, people, reviews and settings endpoints', async () => {
    const { client, calls } = recording('tok');
    await client.documents({ q: 'ali', expiringBefore: '2026-11-01', status: '' });
    await client.party(4);
    await client.eraseParty(4);
    await client.revokeFaceTemplate(4, 9);
    await client.reviewCases({ status: 'OPEN', mine: true });
    await client.assignReviewCase(3);
    await client.decideReviewCase(3, { decision: 'APPROVED', note: 'same person' });
    await client.updateReviewSettings('CAMTECH');
    await client.updateDocumentSettings(45);
    await client.retentionPolicies();
    expect(calls.map((c) => `${c.init.method} ${c.url.replace('https://api.example/camtech-service', '')}`)).toEqual([
      'GET /v2/tenant/documents?q=ali&expiringBefore=2026-11-01',
      'GET /v2/tenant/parties/4',
      'DELETE /v2/tenant/parties/4',
      'POST /v2/tenant/parties/4/face-templates/9/revoke',
      'GET /v2/tenant/review-cases?status=OPEN&mine=true',
      'POST /v2/tenant/review-cases/3/assign',
      'POST /v2/tenant/review-cases/3/decide',
      'PUT /v2/tenant/review-settings',
      'PUT /v2/tenant/document-settings',
      'GET /v2/tenant/retention-policies',
    ]);
    expect(JSON.parse(calls[5].init.body as string)).toEqual({ assignee: null });
    expect(JSON.parse(calls[6].init.body as string)).toEqual({ decision: 'APPROVED', note: 'same person' });
    expect(JSON.parse(calls[7].init.body as string)).toEqual({ owner: 'CAMTECH' });
    expect(JSON.parse(calls[8].init.body as string)).toEqual({ expiryWarningDays: 45 });
  });

  it('fetches images and exports as blobs with the bearer token', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const client = new CamtechTenantClient({
      baseUrl: 'https://api.example',
      token: () => 'tok-img',
      transport: async (url, init) => {
        calls.push({ url, init });
        return new Response(new Uint8Array([137, 80, 78, 71]), { status: 200, headers: { 'Content-Type': 'image/png' } });
      },
    });
    const img = await client.media(12);
    expect(img.size).toBe(4);
    expect(img.type).toBe('image/png');
    await client.reviewCaseMedia(3, 44);
    await client.exportParty(4);
    expect(calls.map((c) => c.url)).toEqual([
      'https://api.example/v2/tenant/media/12',
      'https://api.example/v2/tenant/review-cases/3/media/44',
      'https://api.example/v2/tenant/parties/4/export',
    ]);
    expect(headers(calls[0].init).get('Authorization')).toBe('Bearer tok-img');
    expect(headers(calls[0].init).get('Accept')).toBe('image/*');
    expect(headers(calls[2].init).get('Accept')).toBe('application/zip');
  });

  it('throws the API error for a missing image', async () => {
    const client = new CamtechTenantClient({
      baseUrl: 'https://api.example',
      transport: async () => new Response(JSON.stringify({ code: 'NOT_FOUND', message: 'Image not found' }), { status: 404 }),
    });
    await expect(client.media(1)).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });
});
