import { Alert, Button, Form, Input } from 'antd';
import { useState } from 'react';
import { errorMessage } from '../api/client';
import { authApi } from '../api/auth';

interface Values {
  currentPassword: string;
  newPassword: string;
  confirm: string;
}

/** Shared by the forced change-password screen and the account menu dialog. */
export function ChangePasswordForm({ onDone, submitLabel = 'Change password' }: { onDone: () => void; submitLabel?: string }) {
  const [form] = Form.useForm<Values>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onFinish = async (v: Values) => {
    setError(null);
    setLoading(true);
    try {
      await authApi.changePassword(v.currentPassword, v.newPassword);
      form.resetFields();
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Form form={form} layout="vertical" onFinish={onFinish} requiredMark={false} disabled={loading}>
      {error && <Alert type="error" showIcon style={{ marginBottom: 16 }} title={error} />}
      <Form.Item name="currentPassword" label="Current (or temporary) password" rules={[{ required: true, message: 'Enter your current password' }]}>
        <Input.Password autoComplete="current-password" />
      </Form.Item>
      <Form.Item
        name="newPassword"
        label="New password"
        extra="At least 10 characters, with letters and numbers."
        rules={[
          { required: true, message: 'Enter a new password' },
          { min: 10, message: 'Use at least 10 characters' },
          { pattern: /^(?=.*[A-Za-z])(?=.*\d).+$/, message: 'Use both letters and numbers' },
        ]}
      >
        <Input.Password autoComplete="new-password" />
      </Form.Item>
      <Form.Item
        name="confirm"
        label="Repeat new password"
        dependencies={['newPassword']}
        rules={[
          { required: true, message: 'Repeat the new password' },
          ({ getFieldValue }) => ({
            validator: (_, value) =>
              !value || getFieldValue('newPassword') === value ? Promise.resolve() : Promise.reject(new Error('The passwords do not match')),
          }),
        ]}
      >
        <Input.Password autoComplete="new-password" />
      </Form.Item>
      <Button type="primary" htmlType="submit" block loading={loading}>
        {submitLabel}
      </Button>
    </Form>
  );
}
