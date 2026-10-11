import { Alert, Modal, Typography } from 'antd';

interface Props {
  open: boolean;
  title: string;
  /** e.g. "client secret", "webhook signing secret", "temporary password". */
  what: string;
  value: string | null;
  extra?: React.ReactNode;
  onClose: () => void;
}

/** Shows a secret exactly once, with a copy button and a clear warning. */
export function SecretModal({ open, title, what, value, extra, onClose }: Props) {
  return (
    <Modal
      open={open}
      title={title}
      onCancel={onClose}
      onOk={onClose}
      okText="I've copied it"
      cancelButtonProps={{ style: { display: 'none' } }}
      mask={{ closable: false }}
      destroyOnHidden
    >
      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 16 }}
        title={`Copy the ${what} now`}
        description={`This is the only time it is shown. It can't be displayed again — if it is lost you will have to create a new one.`}
      />
      {extra}
      <Typography.Paragraph
        copyable={{ text: value ?? '', tooltips: ['Copy', 'Copied'] }}
        code
        style={{ fontSize: 15, wordBreak: 'break-all', padding: 8 }}
      >
        {value}
      </Typography.Paragraph>
    </Modal>
  );
}
