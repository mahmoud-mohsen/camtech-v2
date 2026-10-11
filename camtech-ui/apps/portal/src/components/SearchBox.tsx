import { SearchOutlined } from '@ant-design/icons';
import { Input } from 'antd';
import { useState } from 'react';

/** Search input that applies on Enter or blur (not on every key), kept in sync with the URL value. */
export function SearchBox({ value, onSearch, placeholder, width = 340 }: { value: string | undefined; onSearch: (v: string) => void; placeholder: string; width?: number }) {
  const [text, setText] = useState(value ?? '');
  const [synced, setSynced] = useState(value);
  if (value !== synced) {
    setSynced(value);
    setText(value ?? '');
  }
  return (
    <Input
      allowClear
      prefix={<SearchOutlined style={{ opacity: 0.5 }} />}
      placeholder={placeholder}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        if (!e.target.value) onSearch('');
      }}
      onPressEnter={() => onSearch(text.trim())}
      onBlur={() => text.trim() !== (value ?? '') && onSearch(text.trim())}
      style={{ width, maxWidth: '100%' }}
      aria-label={placeholder}
    />
  );
}
