import { LockOutlined } from '@ant-design/icons';
import { Alert, Button, Checkbox, Flex, Modal, theme, Typography } from 'antd';
import { useState, type ReactNode } from 'react';
import { CopyButton } from './CopyButton';

export interface SecretField {
  label: string;
  value: string;
  /** Secret values get the warning styling; ids don't. */
  secret?: boolean;
}

interface Props {
  open: boolean;
  title: string;
  /** e.g. "API secret", "signing secret". */
  what: string;
  fields: SecretField[];
  /** Text copied by "Copy as .env", e.g. CAMTECH_CLIENT_ID=…\nCAMTECH_CLIENT_SECRET=… */
  envText?: string;
  extra?: ReactNode;
  onClose: () => void;
}

/** Shows a secret exactly once, with copy buttons and a strong warning. Closing needs an explicit acknowledgement. */
export function SecretModal({ open, title, what, fields, envText, extra, onClose }: Props) {
  const { token } = theme.useToken();
  const [stored, setStored] = useState(false);
  const close = () => {
    setStored(false);
    onClose();
  };
  return (
    <Modal
      open={open}
      title={
        <Flex align="center" gap={8}>
          <LockOutlined /> {title}
        </Flex>
      }
      closable={false}
      mask={{ closable: false }}
      keyboard={false}
      destroyOnHidden
      width={600}
      footer={
        <Flex justify="space-between" align="center" gap={12} wrap>
          <Checkbox checked={stored} onChange={(e) => setStored(e.target.checked)}>
            I have stored the {what} somewhere safe
          </Checkbox>
          <Button type="primary" disabled={!stored} onClick={close}>
            Done
          </Button>
        </Flex>
      }
    >
      <Alert
        type="error"
        showIcon
        style={{ marginBottom: 16 }}
        title={`Store the ${what} now — it is shown only once`}
        description={`CamTech keeps only a hash of it. Once you close this window it can't be displayed again; if it is lost, create a new one and revoke this one.`}
      />
      {extra}
      <Flex vertical gap={12}>
        {fields.map((f) => (
          <div key={f.label}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {f.label}
            </Typography.Text>
            <Flex
              align="center"
              gap={8}
              style={{
                marginTop: 4,
                padding: '8px 8px 8px 12px',
                borderRadius: token.borderRadius,
                border: `1px solid ${f.secret ? token.colorErrorBorder : token.colorBorderSecondary}`,
                background: f.secret ? token.colorErrorBg : token.colorFillQuaternary,
              }}
            >
              <Typography.Text style={{ fontFamily: token.fontFamilyCode, fontSize: 14, wordBreak: 'break-all', flex: 1 }}>{f.value}</Typography.Text>
              <CopyButton text={f.value} label={`Copy ${f.label.toLowerCase()}`} />
            </Flex>
          </div>
        ))}
        {envText && (
          <Flex justify="flex-end">
            <CopyButton text={envText} label="Copy as .env" showLabel />
          </Flex>
        )}
      </Flex>
    </Modal>
  );
}
