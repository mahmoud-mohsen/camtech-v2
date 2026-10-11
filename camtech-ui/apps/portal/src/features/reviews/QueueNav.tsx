import { LeftOutlined, RightOutlined } from '@ant-design/icons';
import { Button, Flex, Space, Tooltip } from 'antd';
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { t } from '../../i18n';
import type { QueuePosition } from './queue';

const typing = (el: EventTarget | null) => el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));

/** "3 of 7" with previous / next buttons; J and K move through the queue (not while typing). */
export function QueueNav({ queue }: { queue: QueuePosition | null }) {
  const navigate = useNavigate();
  const prev = queue?.prev ?? null;
  const next = queue?.next ?? null;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
      if (e.key === 'j' && next) navigate(next);
      if (e.key === 'k' && prev) navigate(prev);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate, next, prev]);
  if (!queue || queue.total === 0) return null;
  return (
    <Flex align="center" gap={10}>
      {queue.position !== null && (
        <span className="ct-meta tabular" style={{ fontWeight: 600 }}>
          {t('queue.position', { n: queue.position, total: queue.total })}
        </span>
      )}
      <Space.Compact>
        <Tooltip title={t('queue.prev')}>
          <Button icon={<LeftOutlined />} aria-label={t('queue.prev')} disabled={!prev} onClick={() => prev && navigate(prev)} />
        </Tooltip>
        <Tooltip title={t('queue.next')}>
          <Button icon={<RightOutlined />} aria-label={t('queue.next')} disabled={!next} onClick={() => next && navigate(next)} />
        </Tooltip>
      </Space.Compact>
    </Flex>
  );
}

/** Tells the reviewer what happens after the decision. */
export function AfterDecisionHint({ queue }: { queue: QueuePosition | null }) {
  if (!queue) return null;
  return <span className="ct-meta">{queue.afterDecision ? t('queue.thenNext', { n: queue.remaining }) : t('queue.last')}</span>;
}
