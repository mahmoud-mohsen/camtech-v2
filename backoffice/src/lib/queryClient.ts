import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (count, err) => {
        if (err instanceof ApiError && [400, 401, 403, 404, 409, 410, 422].includes(err.status)) return false;
        return count < 2;
      },
    },
    mutations: { retry: false },
  },
});
