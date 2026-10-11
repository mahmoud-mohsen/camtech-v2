import { DeleteOutlined, PictureOutlined, WarningOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Flex, Image, Skeleton, theme, Tooltip, Typography } from 'antd';
import { useEffect, useState, type CSSProperties } from 'react';
import { ApiError } from '../api/client';
import { mediaApi } from '../api/operations';
import type { MediaRef } from '../api/types';
import { formatBytes, formatDateTime } from '../lib/format';
import { mediaRoleLabel } from '../lib/labels';

/**
 * Fetches a media file with the bearer token. The Blob is cached by React Query (shared by every thumbnail of the
 * same file); object URLs are made per component by useObjectUrl so they can be revoked.
 */
function useMediaBlob(id: number | null | undefined) {
  return useQuery({
    queryKey: ['media', id],
    queryFn: () => mediaApi.blob(id!),
    enabled: !!id,
    staleTime: Infinity,
    gcTime: 30 * 60_000,
  });
}

/** An object URL for `blob`, revoked when the blob changes or the component unmounts. */
function useObjectUrl(blob: Blob | undefined): string | undefined {
  const [state, setState] = useState<{ blob: Blob; url: string } | null>(null);
  useEffect(() => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    setState({ blob, url });
    return () => URL.revokeObjectURL(url);
  }, [blob]);
  return state && state.blob === blob ? state.url : undefined;
}

interface Props {
  media: MediaRef | null | undefined;
  width?: number | string;
  height?: number | string;
  caption?: string | false;
  fit?: CSSProperties['objectFit'];
}

function Placeholder({ width, height, icon, text }: { width: Props['width']; height: Props['height']; icon: React.ReactNode; text: string }) {
  const { token } = theme.useToken();
  return (
    <Flex
      vertical
      align="center"
      justify="center"
      gap={6}
      style={{
        width, height, background: token.colorFillTertiary, borderRadius: token.borderRadius, color: token.colorTextTertiary,
        fontSize: 12, textAlign: 'center', padding: 8, border: `1px dashed ${token.colorBorder}`,
      }}
    >
      <span style={{ fontSize: 22 }}>{icon}</span>
      {text}
    </Flex>
  );
}

/** One image (thumbnail, click to enlarge). Shows a placeholder when the file was purged (410). */
export function MediaImage({ media, width = 120, height = 120, caption, fit = 'cover' }: Props) {
  const { token } = theme.useToken();
  const q = useMediaBlob(media?.id);
  const url = useObjectUrl(q.data);
  let body: React.ReactNode;
  if (!media) body = <Placeholder width={width} height={height} icon={<PictureOutlined />} text="No image" />;
  else if (q.isPending || (q.isSuccess && !url)) body = <Skeleton.Node active style={{ width: typeof width === 'number' ? width : 120, height: typeof height === 'number' ? height : 120 }} />;
  else if (q.isError) {
    const purged = q.error instanceof ApiError && q.error.status === 410;
    body = purged ? (
      <Placeholder width={width} height={height} icon={<DeleteOutlined />} text="Image deleted by the data retention policy" />
    ) : (
      <Placeholder width={width} height={height} icon={<WarningOutlined />} text="Couldn't load image" />
    );
  } else {
    body = (
      <Image
        src={url}
        width={width}
        height={height}
        alt={mediaRoleLabel(media.role)}
        style={{ objectFit: fit, borderRadius: token.borderRadius, background: token.colorFillQuaternary }}
      />
    );
  }
  const cap = caption === false ? null : (caption ?? (media ? mediaRoleLabel(media.role) : null));
  return (
    <Flex vertical gap={4} style={{ width }}>
      {body}
      {cap && media && (
        <Tooltip title={`${media.role} · ${media.width ?? '?'}×${media.height ?? '?'} · ${formatBytes(media.byteCount)} · ${formatDateTime(media.createdAt)}`}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }} ellipsis>
            {cap}
          </Typography.Text>
        </Tooltip>
      )}
    </Flex>
  );
}

/** A row of thumbnails sharing one preview (arrow keys move between them). */
export function MediaGallery({ items, size = 96 }: { items: MediaRef[]; size?: number }) {
  if (!items.length) return <Typography.Text type="secondary">No images</Typography.Text>;
  return (
    <Image.PreviewGroup>
      <Flex gap={12} wrap>
        {items.map((m) => (
          <MediaImage key={m.id} media={m} width={size} height={size} />
        ))}
      </Flex>
    </Image.PreviewGroup>
  );
}
