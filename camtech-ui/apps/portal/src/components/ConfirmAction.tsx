import { Button, Input, Modal, Typography, type ButtonProps } from 'antd';
import { useState, type ReactNode } from 'react';

interface Props {
  /** Button label. */
  label: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  okText?: string;
  danger?: boolean;
  /** When set, the user must type this exact text to enable the confirm button. */
  typeToConfirm?: string;
  onConfirm: () => Promise<unknown> | unknown;
  buttonProps?: ButtonProps;
  disabled?: boolean;
}

/** Button that asks for confirmation (optionally typed) before running an irreversible action. */
export function ConfirmAction({ label, title, description, okText = 'Confirm', danger, typeToConfirm, onConfirm, buttonProps, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const close = () => {
    setOpen(false);
    setTyped('');
  };
  const run = async () => {
    setBusy(true);
    try {
      await onConfirm();
      close();
    } catch {
      /* the mutation shows its own error toast */
    } finally {
      setBusy(false);
    }
  };
  const canConfirm = typeToConfirm ? typed.trim() === typeToConfirm : true;
  return (
    <>
      <Button danger={danger} disabled={disabled} {...buttonProps} onClick={(e) => {
        e.stopPropagation();
        setOpen(true);
      }}>
        {label}
      </Button>
      <Modal
        open={open}
        title={title}
        onCancel={close}
        onOk={() => void run()}
        okText={okText}
        okButtonProps={{ danger, loading: busy, disabled: !canConfirm }}
        cancelText="Cancel"
        destroyOnHidden
      >
        {description && <div style={{ marginBottom: typeToConfirm ? 16 : 0 }}>{description}</div>}
        {typeToConfirm && (
          <>
            <Typography.Paragraph>
              Type <Typography.Text code>{typeToConfirm}</Typography.Text> to confirm.
            </Typography.Paragraph>
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus placeholder={typeToConfirm} onPressEnter={() => canConfirm && void run()} />
          </>
        )}
      </Modal>
    </>
  );
}
