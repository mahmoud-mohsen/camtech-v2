import { Skeleton } from 'antd';

export function PageSkeleton() {
  return (
    <div>
      <Skeleton.Input active style={{ width: 280, marginBottom: 16 }} />
      <Skeleton active paragraph={{ rows: 10 }} />
    </div>
  );
}
