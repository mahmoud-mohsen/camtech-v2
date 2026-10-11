import { Input, InputNumber, Select, Switch } from 'antd';
import type { ConfigKey } from '../../api/types';

interface Props {
  configKey: ConfigKey;
  value?: string;
  onChange?: (v: string) => void;
  disabled?: boolean;
}

/** Type-aware input for a config value. The value is always a string (as stored). */
export function ValueInput({ configKey, value, onChange, disabled }: Props) {
  const k = configKey;
  switch (k.type) {
    case 'NUMBER':
    case 'INTEGER':
      return (
        <InputNumber
          style={{ width: 200 }}
          value={value === undefined || value === '' ? null : Number(value)}
          min={k.min ?? undefined}
          max={k.max ?? undefined}
          step={k.type === 'INTEGER' ? 1 : (k.max ?? 10) <= 1 ? 0.01 : 0.1}
          precision={k.type === 'INTEGER' ? 0 : undefined}
          disabled={disabled}
          onChange={(v) => onChange?.(v === null ? '' : String(v))}
        />
      );
    case 'BOOLEAN':
      return <Switch checked={value === 'true'} disabled={disabled} onChange={(v) => onChange?.(v ? 'true' : 'false')} checkedChildren="On" unCheckedChildren="Off" />;
    case 'LIST':
      return (
        <Select
          mode="tags"
          style={{ minWidth: 260 }}
          disabled={disabled}
          value={value ? value.split(',').map((s) => s.trim()).filter(Boolean) : []}
          onChange={(v: string[]) => onChange?.(v.join(','))}
          tokenSeparators={[',']}
          open={false}
          placeholder="Type a value and press Enter"
        />
      );
    default:
      return <Input value={value} disabled={disabled} onChange={(e) => onChange?.(e.target.value)} style={{ maxWidth: 360 }} />;
  }
}

