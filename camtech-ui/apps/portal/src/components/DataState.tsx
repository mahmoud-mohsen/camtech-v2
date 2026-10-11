import { LockOutlined } from '@ant-design/icons';
import { CamtechApiError, errorMessage } from '@camtech/api-client';
import { Button, Empty, Result, Skeleton } from 'antd';
import type { ReactNode } from 'react';
import { t } from '../i18n';

/** Error view with a retry button. 403 and 404 get their own wording. */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (error instanceof CamtechApiError && error.status === 403) {
    return <Result icon={<LockOutlined />} title="Not available" subTitle={error.message || "Your tenant can't see this information."} />;
  }
  if (error instanceof CamtechApiError && error.status === 404) {
    return <Result status="404" title="Not found" subTitle={error.message} />;
  }
  return (
    <Result
      status="warning"
      title={t('error.title')}
      subTitle={errorMessage(error)}
      extra={
        onRetry && (
          <Button type="primary" onClick={onRetry}>
            {t('common.retry')}
          </Button>
        )
      }
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

/** Skeleton while loading, error with retry, an empty state, or the content. */
export function DataState<T>({
  query,
  children,
  isEmpty,
  empty,
  rows = 6,
  skeleton,
}: {
  query: QueryLike<T>;
  children: (data: T) => ReactNode;
  isEmpty?: (data: T) => boolean;
  empty?: ReactNode;
  rows?: number;
  skeleton?: ReactNode;
}) {
  if (query.isPending) return <>{skeleton ?? <Skeleton active paragraph={{ rows }} />}</>;
  if (query.isError || query.data === undefined) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  if (isEmpty?.(query.data)) return <>{empty ?? <Empty description="Nothing here yet" />}</>;
  return <>{children(query.data)}</>;
}
