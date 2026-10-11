import { CamtechApiError } from '@camtech/api-client';
import { QueryClient } from '@tanstack/react-query';

/** Lists refresh on their own this often, so nobody needs a Refresh button. */
export const LIST_REFETCH_MS = 60_000;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (count, err) => {
        if (err instanceof CamtechApiError && err.status >= 400 && err.status < 500) return false;
        return count < 2;
      },
    },
    mutations: { retry: false },
  },
});
