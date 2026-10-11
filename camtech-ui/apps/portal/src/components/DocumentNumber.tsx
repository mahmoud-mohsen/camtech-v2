import { EyeInvisibleOutlined, EyeOutlined } from '@ant-design/icons';
import { Button, Flex, Tooltip, Typography } from 'antd';
import { useState } from 'react';
import { maskDocumentNumber } from '../lib/mask';

/** A document number, masked until the user reveals it. */
export function DocumentNumber({ value }: { value: string | null }) {
  const [shown, setShown] = useState(false);
  if (!value) return <span>—</span>;
  return (
    <Flex align="center" gap={4}>
      <Typography.Text className="tabular" style={{ fontFamily: 'monospace' }} copyable={shown ? { text: value } : false}>
        {shown ? value : maskDocumentNumber(value)}
      </Typography.Text>
      <Tooltip title={shown ? 'Hide' : 'Reveal the full number'}>
        <Button
          type="text"
          size="small"
          icon={shown ? <EyeInvisibleOutlined /> : <EyeOutlined />}
          onClick={() => setShown((s) => !s)}
          aria-label={shown ? 'Hide document number' : 'Reveal document number'}
          aria-pressed={shown}
        />
      </Tooltip>
    </Flex>
  );
}
