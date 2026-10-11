import { DesktopOutlined, LinkOutlined, MobileOutlined, ReloadOutlined } from '@ant-design/icons';
import type { Branding, Lang } from '@camtech/api-client';
import { Button, Card, Flex, Segmented, Select, Spin, theme, Tooltip, Typography } from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';
import { SDK_ORIGIN, SDK_URL } from '../../env';
import { parseSdkMessage, type PortalBrandingMessage } from '../../lib/sdkMessages';
import { PREVIEW_SCREENS, type PreviewScreen } from './brandingForm';

type Frame = 'phone' | 'desktop';

/** The real SDK in preview mode, re-themed live through postMessage on every form change. */
export function BrandingPreview({ branding }: { branding: Branding }) {
  const { token } = theme.useToken();
  const iframe = useRef<HTMLIFrameElement>(null);
  const [screen, setScreen] = useState<PreviewScreen>('welcome');
  const [lang, setLang] = useState<Lang>('en');
  const [frame, setFrame] = useState<Frame>('phone');
  const [loaded, setLoaded] = useState(false);
  const [ready, setReady] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const latest = useRef(branding);
  useEffect(() => {
    latest.current = branding;
  }, [branding]);

  const src = `${SDK_URL}/?${new URLSearchParams({ preview: '1', screen, lang }).toString()}`;

  const post = useCallback(() => {
    const win = iframe.current?.contentWindow;
    if (!win) return;
    const msg: PortalBrandingMessage = { source: 'camtech-portal', type: 'branding', payload: latest.current };
    win.postMessage(msg, SDK_ORIGIN);
  }, []);

  // Post after load, and (debounced) on every change.
  useEffect(() => {
    if (!loaded) return;
    const id = window.setTimeout(post, 120);
    return () => window.clearTimeout(id);
  }, [branding, loaded, post]);

  // The SDK announces itself; answer with the current branding so it never shows stale colours.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== SDK_ORIGIN || e.source !== iframe.current?.contentWindow) return;
      const msg = parseSdkMessage(e.data);
      if (msg?.type === 'ready') {
        setReady(true);
        post();
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [post]);

  const reset = () => {
    setLoaded(false);
    setReady(false);
  };

  const phone = frame === 'phone';
  const frameEl = (
    <div style={{ position: 'relative', width: phone ? 360 : '100%', maxWidth: '100%', height: phone ? 700 : 600 }}>
      {!loaded && (
        <Flex align="center" justify="center" style={{ position: 'absolute', inset: 0, zIndex: 1 }}>
          <Spin />
        </Flex>
      )}
      <iframe
        key={`${src}-${reloadKey}`}
        ref={iframe}
        src={src}
        title="SDK preview"
        onLoad={() => setLoaded(true)}
        style={{ width: '100%', height: '100%', border: 0, display: 'block', background: branding.backgroundColor }}
        sandbox="allow-scripts allow-same-origin"
      />
    </div>
  );

  return (
    <Card
      size="small"
      title="Live preview"
      extra={
        <Flex gap={4} align="center">
          <Tooltip title="Reload preview">
            <Button
              type="text"
              size="small"
              icon={<ReloadOutlined />}
              aria-label="Reload preview"
              onClick={() => {
                reset();
                setReloadKey((k) => k + 1);
              }}
            />
          </Tooltip>
          <Tooltip title="Open in a new tab (shows saved branding)">
            <Button type="text" size="small" icon={<LinkOutlined />} href={src} target="_blank" rel="noopener noreferrer" aria-label="Open preview in a new tab" />
          </Tooltip>
        </Flex>
      }
      styles={{ body: { padding: 12 } }}
    >
      <Flex vertical gap={12}>
        <Flex gap={8} wrap justify="space-between">
          <Select<PreviewScreen>
            value={screen}
            onChange={(v) => {
              reset();
              setScreen(v);
            }}
            options={PREVIEW_SCREENS.map((s) => ({ value: s.value, label: s.label }))}
            style={{ width: 150 }}
            aria-label="Preview screen"
          />
          <Flex gap={8}>
            <Segmented<Lang>
              value={lang}
              onChange={(v) => {
                reset();
                setLang(v);
              }}
              options={[{ value: 'en', label: 'EN' }, { value: 'ar', label: 'ع' }]}
              aria-label="Preview language"
            />
            <Segmented<Frame>
              value={frame}
              onChange={setFrame}
              options={[
                { value: 'phone', icon: <MobileOutlined />, title: 'Phone' },
                { value: 'desktop', icon: <DesktopOutlined />, title: 'Desktop' },
              ]}
              aria-label="Preview frame"
            />
          </Flex>
        </Flex>
        <Flex justify="center" style={{ padding: phone ? '8px 0' : 0, background: token.colorFillQuaternary, borderRadius: token.borderRadiusLG, overflow: 'hidden' }}>
          {phone ? (
            <div className="device-phone">{frameEl}</div>
          ) : (
            <div className="device-desktop" style={{ width: '100%' }}>
              <div className="device-desktop-bar">
                <i style={{ background: '#ff5f57' }} />
                <i style={{ background: '#febc2e' }} />
                <i style={{ background: '#28c840' }} />
              </div>
              {frameEl}
            </div>
          )}
        </Flex>
        <Typography.Text type="secondary" className="ct-meta">
          {ready ? 'Connected to the SDK: changes apply instantly, before you save.' : (
            <>
              The preview runs the SDK from <Typography.Text code style={{ fontSize: 12 }}>{SDK_URL}</Typography.Text>. If it stays blank, start it with{' '}
              <Typography.Text code style={{ fontSize: 12 }}>npm run dev:sdk</Typography.Text>.
            </>
          )}
        </Typography.Text>
      </Flex>
    </Card>
  );
}
