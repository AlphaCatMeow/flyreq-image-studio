import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const serverSource = fs.readFileSync(
  path.resolve(testDir, '../../../../backend/server.js'),
  'utf8',
);

describe('后端平台品牌配置', () => {
  it('从环境变量分别读取平台名称、Logo、favicon 和 PWA 图标地址', () => {
    expect(serverSource).toContain('FLYREQ_PLATFORM_NAME');
    expect(serverSource).toContain('FLYREQ_PLATFORM_LOGO_URL');
    expect(serverSource).toContain('FLYREQ_PLATFORM_ICON_URL');
    expect(serverSource).toContain('FLYREQ_PWA_ICON_192_URL');
    expect(serverSource).toContain('FLYREQ_PWA_ICON_512_URL');
    expect(serverSource).toContain('FLYREQ_PWA_MASKABLE_ICON_512_URL');
    expect(serverSource).toContain('process.env.APP_VERSION');
    expect(serverSource).toContain('function resolvePlatformBranding(env = getRuntimeEnv())');
  });

  it('将品牌配置下发给页面和动态 PWA Manifest', () => {
    expect(serverSource).toContain('branding: resolvePlatformBranding(env)');
    expect(serverSource).toContain("'/api/flyreq/manifest.webmanifest'");
    expect(serverSource).toContain('buildPlatformManifest(resolvePlatformBranding(getRuntimeEnv()))');
    expect(serverSource).toContain("{ src: branding.pwaIcon192Url, sizes: '192x192', type: 'image/png', purpose: 'any' }");
    expect(serverSource).toContain("{ src: branding.pwaIcon512Url, sizes: '512x512', type: 'image/png', purpose: 'any' }");
    expect(serverSource).toContain("{ src: branding.pwaMaskableIcon512Url, sizes: '512x512', type: 'image/png', purpose: 'maskable' }");
  });
});
