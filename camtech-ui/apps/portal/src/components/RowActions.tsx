import { MoreOutlined } from '@ant-design/icons';
import { App, Button, Dropdown, Flex, Tooltip, type MenuProps } from 'antd';
import type { ReactNode } from 'react';
import { t } from '../i18n';

export interface RowAction {
  key: string;
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  /** Why the action is disabled, or what it does. */
  hint?: string;
  onClick: () => unknown;
  /** Asks first (for actions that cannot be undone). */
  confirm?: { title: string; description?: ReactNode; okText: string };
}

/**
 * Actions of a table row: the most used one as a button, the rest behind a "⋯" menu.
 * Clicks never reach the row (rows open a detail view).
 */
export function RowActions({ primary, items, label }: { primary?: ReactNode; items: RowAction[]; label: string }) {
  const { modal } = App.useApp();
  const run = (a: RowAction) => {
    if (!a.confirm) return void a.onClick();
    modal.confirm({
      title: a.confirm.title,
      content: a.confirm.description,
      okText: a.confirm.okText,
      okButtonProps: { danger: a.danger },
      cancelText: t('common.cancel'),
      onOk: async () => {
        try {
          await a.onClick();
        } catch {
          /* the mutation shows its own error toast */
        }
      },
    });
  };
  const menu: MenuProps['items'] = items.map((a) => ({
    key: a.key,
    icon: a.icon,
    danger: a.danger,
    disabled: a.disabled,
    label: a.hint ? <Tooltip title={a.hint} placement="left">{a.label}</Tooltip> : a.label,
    onClick: ({ domEvent }) => {
      domEvent.stopPropagation();
      run(a);
    },
  }));
  return (
    <Flex gap={4} justify="flex-end" align="center" onClick={(e) => e.stopPropagation()}>
      {primary}
      {items.length > 0 && (
        <Dropdown menu={{ items: menu }} trigger={['click']} placement="bottomRight">
          <Button size="small" type="text" icon={<MoreOutlined />} aria-label={label} />
        </Dropdown>
      )}
    </Flex>
  );
}
