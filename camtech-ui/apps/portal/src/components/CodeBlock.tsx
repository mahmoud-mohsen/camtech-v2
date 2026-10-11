import { Flex, Segmented, theme, Typography } from 'antd';
import { useState } from 'react';
import type { Snippet } from '../lib/snippets';
import { CopyButton } from './CopyButton';

/** A dark code panel with a copy button. */
export function CodeBlock({ code, lang, maxHeight = 460, title }: { code: string; lang?: string; maxHeight?: number; title?: string }) {
  const { token } = theme.useToken();
  return (
    <div style={{ position: 'relative', borderRadius: token.borderRadiusLG, overflow: 'hidden', border: `1px solid ${token.colorBorderSecondary}` }}>
      <Flex
        justify="space-between"
        align="center"
        style={{ padding: '4px 6px 4px 12px', background: '#16161d', borderBottom: '1px solid #2a2a35' }}
      >
        <Typography.Text style={{ color: '#9b9bb0', fontSize: 12, fontFamily: token.fontFamilyCode }}>{title ?? lang ?? ''}</Typography.Text>
        <span className="code-copy">
          <CopyButton text={code} />
        </span>
      </Flex>
      <pre
        className="code-block"
        style={{
          margin: 0,
          padding: '12px 14px',
          maxHeight,
          overflow: 'auto',
          fontSize: 12.5,
          lineHeight: 1.6,
          background: '#1c1c24',
          color: '#e6e6f0',
          fontFamily: token.fontFamilyCode,
          whiteSpace: 'pre',
          tabSize: 2,
        }}
      >
        <code>{code}</code>
      </pre>
    </div>
  );
}

/** Several snippets (languages) with a switcher. */
export function SnippetTabs({ snippets, maxHeight }: { snippets: Snippet[]; maxHeight?: number }) {
  const [key, setKey] = useState(snippets[0]?.key ?? '');
  const current = snippets.find((s) => s.key === key) ?? snippets[0];
  if (!current) return null;
  return (
    <Flex vertical gap={8}>
      {snippets.length > 1 && (
        <Segmented size="small" value={current.key} onChange={(v) => setKey(String(v))} options={snippets.map((s) => ({ value: s.key, label: s.label }))} style={{ alignSelf: 'flex-start' }} />
      )}
      <CodeBlock code={current.code} lang={current.lang} maxHeight={maxHeight} />
    </Flex>
  );
}
