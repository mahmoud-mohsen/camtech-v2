import { DeleteOutlined, PictureOutlined, UploadOutlined } from '@ant-design/icons';
import { App, Button, Flex, theme, Typography, Upload } from 'antd';
import { useState } from 'react';
import { formatBytes } from '../../lib/format';
import { LOGO_ACCEPT, LogoError, prepareLogo } from '../../lib/image';

interface Props {
  value?: string | null;
  onChange?: (v: string | null) => void;
}

/** Logo picker: PNG/JPG are resized to 512px max and kept under 300 KB; SVG is kept as is. */
export function LogoInput({ value, onChange }: Props) {
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<string | null>(null);

  const handle = async (file: File) => {
    setBusy(true);
    try {
      const r = await prepareLogo(file);
      onChange?.(r.dataUrl);
      setInfo(`${r.width && r.height ? `${r.width}×${r.height}px · ` : 'SVG · '}${formatBytes(r.bytes)}`);
    } catch (e) {
      message.error(e instanceof LogoError ? e.message : 'Could not use this image');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Flex gap={16} align="center" wrap>
      <div
        style={{
          width: 120, height: 72, borderRadius: token.borderRadius, border: `1px dashed ${token.colorBorder}`, display: 'grid', placeItems: 'center',
          background: `repeating-conic-gradient(${token.colorFillQuaternary} 0% 25%, transparent 0% 50%) 50% / 16px 16px`, overflow: 'hidden', flex: 'none',
        }}
      >
        {value ? (
          <img src={value} alt="Logo preview" style={{ maxWidth: '90%', maxHeight: '86%', objectFit: 'contain' }} />
        ) : (
          <PictureOutlined style={{ fontSize: 24, opacity: 0.35 }} />
        )}
      </div>
      <Flex vertical gap={6}>
        <Flex gap={8}>
          <Upload
            accept={LOGO_ACCEPT}
            showUploadList={false}
            maxCount={1}
            beforeUpload={(file) => {
              void handle(file);
              return Upload.LIST_IGNORE;
            }}
          >
            <Button icon={<UploadOutlined />} loading={busy}>
              {value ? 'Replace' : 'Upload logo'}
            </Button>
          </Upload>
          {value && (
            <Button
              icon={<DeleteOutlined />}
              onClick={() => {
                onChange?.(null);
                setInfo(null);
              }}
            >
              Remove
            </Button>
          )}
        </Flex>
        <Typography.Text type="secondary" className="ct-meta">
          {info ?? 'PNG, JPG or SVG. Resized to 512 px; up to 300 KB. A transparent background looks best.'}
        </Typography.Text>
      </Flex>
    </Flex>
  );
}
