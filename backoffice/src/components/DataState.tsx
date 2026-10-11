import { LockOutlined } from '@ant-design/icons';
import { Button, Empty, Result, Skeleton } from 'antd';
import type { ReactNode } from 'react';
import { ApiError, errorMessage } from '../api/client';

/** Error view with a retry button. 403 shows a clear permission message. */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (error instanceof ApiError && error.status === 403) {
    return (
      <Result
        icon={<LockOutlined />}
        title="You don't have permission"
        subTitle="Your role can't see this information. Ask an administrator if you need access."
      />
    );
  }
  if (error instanceof ApiError && error.status === 404) {
    return <Result status="404" title="Not found" subTitle={error.message} />;
  }
  return (
    <Result
      status="warning"
      title="Couldn't load this"
      subTitle={errorMessage(error)}
      extra={onRetry && (
        <Button type="primary" onClick={onRetry}>
          Try again
        </Button>
      )}
    />
  );
}

interface QueryLike<T> {
  data: T | undefined;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => unknown;
}

/**
 * Renders skeleton while loading, error with retry, an empty state, or the content.
 */
export function DataState<T>({
  query,
  children,
  isEmpty,
  empty,
  rows = 6,
}: {
  query: QueryLike<T>;
  children: (data: T) => ReactNode;
  isEmpty?: (data: T) => boolean;
  empty?: ReactNode;
  rows?: number;
}) {
  if (query.isPending) return <Skeleton active paragraph={{ rows }} />;
  if (query.isError || query.data === undefined) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  if (isEmpty?.(query.data)) return <>{empty ?? <Empty description="Nothing here yet" />}</>;
  return <>{children(query.data)}</>;
}
