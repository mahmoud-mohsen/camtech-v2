import { CloseOutlined, GlobalOutlined, PlusOutlined } from '@ant-design/icons';
import { Button, Empty, Flex, Input, theme, Typography } from 'antd';
import { useState } from 'react';
import { validateOrigin } from '../../lib/origins';

interface Props {
  value?: string[];
  onChange?: (v: string[]) => void;
  disabled?: boolean;
}

/** Edits a list of allowed origins; each one is validated and normalised as it is added. */
export function OriginsEditor({ value = [], onChange, disabled }: Props) {
  const { token } = theme.useToken();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const add = () => {
    if (!draft.trim()) return;
    const r = validateOrigin(draft);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    if (value.includes(r.origin)) {
      setError('This origin is already in the list');
      return;
    }
    onChange?.([...value, r.origin]);
    setDraft('');
    setError(null);
  };

  return (
    <Flex vertical gap={8}>
      {value.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No origins yet" style={{ margin: '4px 0' }} />
      ) : (
        <Flex vertical gap={4} role="list" aria-label="Allowed origins">
          {value.map((o) => (
            <Flex
              key={o}
              role="listitem"
              align="center"
              gap={8}
              style={{ padding: '4px 4px 4px 10px', borderRadius: token.borderRadius, border: `1px solid ${token.colorBorderSecondary}`, background: token.colorFillQuaternary }}
            >
              <GlobalOutlined style={{ opacity: 0.5 }} />
              <Typography.Text style={{ fontFamily: token.fontFamilyCode, fontSize: 13, flex: 1, wordBreak: 'break-all' }}>{o}</Typography.Text>
              {!disabled && (
                <Button type="text" size="small" icon={<CloseOutlined />} aria-label={`Remove ${o}`} onClick={() => onChange?.(value.filter((x) => x !== o))} />
              )}
            </Flex>
          ))}
        </Flex>
      )}
      {!disabled && (
        <div>
          <Flex gap={8}>
            <Input
              value={draft}
              status={error ? 'error' : undefined}
              placeholder="https://app.example.com"
              onChange={(e) => {
                setDraft(e.target.value);
                setError(null);
              }}
              onPressEnter={(e) => {
                e.preventDefault();
                add();
              }}
              style={{ fontFamily: token.fontFamilyCode }}
              aria-label="New origin"
              aria-invalid={!!error}
            />
            <Button icon={<PlusOutlined />} onClick={add} disabled={!draft.trim()}>
              Add
            </Button>
          </Flex>
          <Typography.Text type={error ? 'danger' : 'secondary'} style={{ fontSize: 12 }} role={error ? 'alert' : undefined}>
            {error ?? 'Scheme and host, optional port: https://host[:port]. No path. http:// only for localhost.'}
          </Typography.Text>
        </div>
      )}
    </Flex>
  );
}
