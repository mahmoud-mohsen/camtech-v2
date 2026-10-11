import { Flex, Skeleton } from 'antd';

export function PageSkeleton() {
  return (
    <Flex vertical gap={16} aria-busy="true">
      <Skeleton.Input active style={{ width: 280 }} />
      <Skeleton active paragraph={{ rows: 10 }} />
    </Flex>
  );
}
