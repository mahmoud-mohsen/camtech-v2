import { Alert, Button, Form, Input } from 'antd';
import { useState } from 'react';
import { api } from '../api/client';
import { t } from '../i18n';
import { hasLettersAndDigits, PASSWORD_MIN_LENGTH } from '../lib/password';
import { describeError } from './useAuth';

interface Values {
  currentPassword: string;
  newPassword: string;
  confirm: string;
}

/** Shared by the forced change-password screen and the account menu dialog. */
export function ChangePasswordForm({ onDone, submitLabel = t('password.change') }: { onDone: () => void | Promise<void>; submitLabel?: string }) {
  const [form] = Form.useForm<Values>();
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);

  const onFinish = async (v: Values) => {
    setError(null);
    setLoading(true);
    try {
      await api.changePassword(v.currentPassword, v.newPassword);
      form.resetFields();
      await onDone();
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Form form={form} layout="vertical" onFinish={(v) => void onFinish(v)} requiredMark={false} disabled={loading}>
      {error !== null && <Alert type="error" showIcon style={{ marginBottom: 16 }} title={describeError(error)} />}
      <Form.Item name="currentPassword" label={t('password.current')} rules={[{ required: true, message: t('password.currentRequired') }]}>
        <Input.Password autoComplete="current-password" autoFocus />
      </Form.Item>
      <Form.Item
        name="newPassword"
        label={t('password.new')}
        extra={t('password.newExtra')}
        rules={[
          { required: true, message: t('password.newRequired') },
          { min: PASSWORD_MIN_LENGTH, message: t('password.tooShort') },
          { validator: (_, value: string | undefined) => (!value || hasLettersAndDigits(value) ? Promise.resolve() : Promise.reject(new Error(t('password.lettersDigits')))) },
        ]}
      >
        <Input.Password autoComplete="new-password" />
      </Form.Item>
      <Form.Item
        name="confirm"
        label={t('password.repeat')}
        dependencies={['newPassword']}
        rules={[
          { required: true, message: t('password.repeatRequired') },
          ({ getFieldValue }) => ({
            validator: (_, value: string | undefined) =>
              !value || getFieldValue('newPassword') === value ? Promise.resolve() : Promise.reject(new Error(t('password.mismatch'))),
          }),
        ]}
      >
        <Input.Password autoComplete="new-password" />
      </Form.Item>
      <Button type="primary" htmlType="submit" block size="large" loading={loading}>
        {submitLabel}
      </Button>
    </Form>
  );
}
