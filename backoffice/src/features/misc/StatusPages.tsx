import { LockOutlined } from '@ant-design/icons';
import { Button, Result } from 'antd';
import { useNavigate } from 'react-router-dom';

export function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <Result
      status="404"
      title="Page not found"
      subTitle="The page you opened doesn't exist."
      extra={<Button type="primary" onClick={() => navigate('/')}>Go to dashboard</Button>}
    />
  );
}

export function ForbiddenPage() {
  const navigate = useNavigate();
  return (
    <Result
      icon={<LockOutlined />}
      title="You don't have permission"
      subTitle="Your role can't open this page. Ask an administrator if you need access."
      extra={<Button onClick={() => navigate('/')}>Go to dashboard</Button>}
    />
  );
}
