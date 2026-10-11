import { LockOutlined } from '@ant-design/icons';
import { Alert, Collapse, theme, Typography } from 'antd';
import { usePermissions } from '../auth/useAuth';

/** Shown on configuration pages for non-admins. */
export function ReadOnlyHint({ what = 'these settings' }: { what?: string }) {
  const { isAdmin } = usePermissions();
  if (isAdmin) return null;
  return (
    <Alert
      type="info"
      showIcon
      icon={<LockOutlined />}
      style={{ marginBottom: 16 }}
      title={`Read-only: only administrators can change ${what}.`}
    />
  );
}

/** Pretty-printed JSON block. */
export function JsonBlock({ value, maxHeight = 320 }: { value: unknown; maxHeight?: number }) {
  const { token } = theme.useToken();
  return (
    <pre
      style={{
        margin: 0, padding: 12, maxHeight, overflow: 'auto', fontSize: 12, background: token.colorFillQuaternary,
        borderRadius: token.borderRadius, border: `1px solid ${token.colorBorderSecondary}`, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      }}
    >
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

/** Collapsible raw text (e.g. OCR output). */
export function RawTextBlock({ text, label = 'Raw text' }: { text: string | null; label?: string }) {
  const { token } = theme.useToken();
  if (!text) return <Typography.Text type="secondary">No raw text</Typography.Text>;
  return (
    <Collapse
      size="small"
      items={[
        {
          key: 'raw',
          label,
          children: (
            <pre style={{ margin: 0, fontSize: 12, whiteSpace: 'pre-wrap', fontFamily: token.fontFamilyCode }}>{text}</pre>
          ),
        },
      ]}
    />
  );
}

/** Small monospace id with copy. */
export function IdText({ value }: { value: string | number | null | undefined }) {
  if (value === null || value === undefined) return <span>—</span>;
  return (
    <Typography.Text copyable={{ text: String(value) }} style={{ fontFamily: 'monospace', fontSize: 12 }}>
      {String(value)}
    </Typography.Text>
  );
}

/** Confidence 0..1 as a percentage with colour. */
export function Confidence({ value, low = 0.75 }: { value: number | null | undefined; low?: number }) {
  const { token } = theme.useToken();
  if (value === null || value === undefined) return <Typography.Text type="secondary">—</Typography.Text>;
  return (
    <span className="tabular" style={{ color: value < low ? token.colorWarningText : undefined }}>
      {(value * 100).toFixed(0)}%
    </span>
  );
}
