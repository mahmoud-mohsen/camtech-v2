import { CheckOutlined, CopyOutlined } from '@ant-design/icons';
import { App, Button, Tooltip, type ButtonProps } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n';

async function writeClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  // Fallback for non-secure contexts (http on a LAN address).
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand('copy');
  document.body.removeChild(ta);
  if (!ok) throw new Error('Copy failed');
}

/** Copy-to-clipboard button with a short "Copied" confirmation. */
export function CopyButton({
  text,
  label = t('common.copy'),
  showLabel = false,
  size = 'small',
  type = 'text',
}: {
  text: string;
  label?: string;
  showLabel?: boolean;
  size?: ButtonProps['size'];
  type?: ButtonProps['type'];
}) {
  const { message } = App.useApp();
  const [done, setDone] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = async () => {
    try {
      await writeClipboard(text);
      setDone(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setDone(false), 1600);
    } catch {
      message.error('Could not copy. Select the text and copy it manually.');
    }
  };
  const icon = done ? <CheckOutlined style={{ color: '#2fb36d' }} /> : <CopyOutlined />;
  const button = (
    <Button size={size} type={type} icon={icon} onClick={() => void copy()} aria-label={label}>
      {showLabel ? (done ? t('common.copied') : label) : null}
    </Button>
  );
  return showLabel ? button : <Tooltip title={done ? t('common.copied') : label}>{button}</Tooltip>;
}
