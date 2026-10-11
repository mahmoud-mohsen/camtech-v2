import { describe, expect, it } from 'vitest';
import { bridgePageSnippet, webViewSnippets, type MobilePlatform } from './mobileSnippets';
import { backendRoutesSnippets, frontendSnippets, sdkTokenSnippets, verifyTokenSnippets, type SnippetContext } from './snippets';

const ctx: SnippetContext = {
  baseUrl: 'https://api.example/camtech-service',
  sdkUrl: 'https://sdk.example',
  tenantCode: 'ACME',
  keyId: 'ck_test',
  journey: ['SELFIE_ID_VERIFICATION'],
  lang: 'ar',
  enrollFace: false,
};

const all = () => [
  ...sdkTokenSnippets(ctx),
  ...backendRoutesSnippets(ctx),
  ...frontendSnippets(ctx),
  ...verifyTokenSnippets(ctx),
  bridgePageSnippet(ctx),
  ...(['ios', 'android', 'react-native', 'flutter'] as MobilePlatform[]).flatMap((p) => webViewSnippets(ctx, p)),
];

describe('integration snippets', () => {
  it('pass apiBaseUrl (the option the SDK reads), never baseUrl', () => {
    for (const s of all()) expect(s.code, s.key).not.toMatch(/\bbaseUrl:/);
    const sdkCalls = [...frontendSnippets(ctx).filter((s) => ['script', 'inline', 'npm', 'react'].includes(s.key)), bridgePageSnippet(ctx)];
    for (const s of sdkCalls) expect(s.code, s.key).toContain(`apiBaseUrl: '${ctx.baseUrl}'`);
  });

  it('opens the modal explicitly', () => {
    const modal = frontendSnippets(ctx).find((s) => s.key === 'script')!;
    expect(modal.code).toContain("mode: 'modal'");
    expect(modal.code).toContain('sdk.open()');
  });

  it('never puts the token in a query string', () => {
    for (const s of all()) expect(s.code, s.key).not.toMatch(/[?&]sdkToken=/);
  });

  it('carries the selected journey, language and enrollFace', () => {
    const hosted = frontendSnippets(ctx).find((s) => s.key === 'redirect')!;
    expect(hosted.code).toContain("'journey', 'SELFIE_ID_VERIFICATION'");
    expect(hosted.code).toContain("'enrollFace', 'false'");
    expect(webViewSnippets(ctx, 'ios').find((s) => s.key === 'open')!.code).toContain('journey=SELFIE_ID_VERIFICATION&lang=ar&enrollFace=false');
  });

  it('documents only claims the result token really has', () => {
    const claims = verifyTokenSnippets(ctx).find((s) => s.key === 'claims')!;
    expect(claims.code).not.toContain('"tenant"');
    expect(claims.code).toContain('"personId"');
    const java = verifyTokenSnippets(ctx).find((s) => s.key === 'java')!;
    expect(java.code).not.toMatch(/Set\.of\("sub"/);
  });

  it('never contains a secret value, only the environment variable', () => {
    for (const s of all()) expect(s.code, s.key).not.toMatch(/X-Client-Secret['"]?\s*[:,]\s*['"][^'"$]/);
  });
});
