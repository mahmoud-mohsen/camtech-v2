import { Button, Flex, Tag } from 'antd';
import type { ReactNode } from 'react';
import { t } from '../i18n';

interface Props {
  dirty: boolean;
  saving?: boolean;
  /** Save stays disabled while the form has an error. */
  invalid?: boolean;
  onSave: () => void;
  onDiscard: () => void;
  saveLabel?: string;
  /** Shown on the left when nothing changed (e.g. "Saved 2 days ago"). */
  status?: ReactNode;
  /** More buttons before Discard (e.g. "Reset to defaults"). */
  extra?: ReactNode;
  /** Card footer (default) or a stand-alone bar under a form that is not in one card. */
  floating?: boolean;
}

/**
 * The one way to save a settings form: "Unsaved changes · Discard · Save". Once something changed it is pinned
 * to the bottom of the window while the form is on screen, so the buttons never scroll out of reach.
 */
export function SaveBar({ dirty, saving, invalid, onSave, onDiscard, saveLabel, status, extra, floating }: Props) {
  return (
    <Flex gap={8} justify="flex-end" align="center" wrap className={`ct-sticky-actions${floating ? ' ct-sticky-actions-floating' : ''}${dirty ? ' ct-pinned' : ''}`}>
      <span style={{ flex: 1, minWidth: 140 }}>
        {dirty ? (
          <Tag color="gold" variant="filled" className="ct-pill">
            {t('common.unsaved')}
          </Tag>
        ) : (
          status
        )}
      </span>
      {extra}
      <Button disabled={!dirty} onClick={onDiscard}>
        {t('common.discard')}
      </Button>
      <Button type="primary" disabled={!dirty || invalid} loading={saving} onClick={onSave}>
        {saveLabel ?? t('common.save')}
      </Button>
    </Flex>
  );
}
