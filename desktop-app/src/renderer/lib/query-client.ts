import { QueryClient } from '@tanstack/react-query';

export const desktopQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      retry: 1,
      refetchOnWindowFocus: false
    }
  }
});
