import { DeleteOutlined, PictureOutlined, ZoomInOutlined } from '@ant-design/icons';
import { CamtechApiError } from '@camtech/api-client';
import { Empty, Flex, Image, Skeleton, theme, Typography } from 'antd';
import type { ReactNode } from 'react';
import { t } from '../i18n';
import { useBlobUrl, type BlobLoader, type GalleryItem } from '../lib/media';

function Placeholder({ icon, text, height }: { icon: ReactNode; text: string; height: number }) {
  const { token } = theme.useToken();
  return (
    <Flex
      vertical
      align="center"
      justify="center"
      gap={6}
      style={{ height, borderRadius: token.borderRadius, background: token.colorFillQuaternary, border: `1px dashed ${token.colorBorder}`, color: token.colorTextTertiary, textAlign: 'center', padding: 8 }}
    >
      <span style={{ fontSize: 26 }}>{icon}</span>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {text}
      </Typography.Text>
    </Flex>
  );
}

interface AuthImageProps {
  load: BlobLoader;
  /** Identifies the image (e.g. `media-12`): a new key loads a new image. */
  cacheKey: string;
  alt: string;
  height?: number;
  /** The image was deleted by the retention policy: shows a placeholder, nothing is fetched. */
  purged?: boolean;
}

/** An image the API only serves with the bearer header, shown from an object URL, with zoom / rotate preview. */
export function AuthImage({ load, cacheKey, alt, height = 220, purged }: AuthImageProps) {
  const { token } = theme.useToken();
  const { url, error, loading } = useBlobUrl(purged ? null : load, cacheKey);
  if (purged) return <Placeholder icon={<DeleteOutlined />} text={t('media.purged')} height={height} />;
  if (error) {
    const missing = error instanceof CamtechApiError && (error.status === 404 || error.status === 403);
    return <Placeholder icon={<PictureOutlined />} text={missing ? t('media.notAvailable') : t('media.failed')} height={height} />;
  }
  if (loading || !url) return <Skeleton.Node active style={{ width: '100%', height }} />;
  return (
    <Image
      src={url}
      alt={alt}
      height={height}
      width="100%"
      style={{ objectFit: 'contain', background: token.colorFillQuaternary, borderRadius: token.borderRadius }}
      preview={{
        cover: (
          <Flex align="center" gap={6}>
            <ZoomInOutlined /> {t('media.zoom')}
          </Flex>
        ),
      }}
    />
  );
}

/** Images side by side (wrapping on narrow screens); the preview pages through all of them. */
export function ImageGallery({ items, height = 220, empty, minWidth = 220 }: { items: GalleryItem[]; height?: number; empty?: string; minWidth?: number }) {
  if (!items.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={empty ?? t('media.none')} />;
  return (
    <Image.PreviewGroup>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(min(${minWidth}px, 100%), 1fr))`, gap: 12 }}>
        {items.map((i) => (
          <figure key={i.key} style={{ margin: 0 }}>
            <AuthImage load={i.load} cacheKey={i.key} alt={typeof i.label === 'string' ? i.label : i.key} height={height} purged={i.purged} />
            <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
              {i.label}
            </Typography.Text>
          </figure>
        ))}
      </div>
    </Image.PreviewGroup>
  );
}
