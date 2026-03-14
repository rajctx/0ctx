import type { PropsWithChildren } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { desktopQueryClient } from '../lib/query-client';
import { desktopRouter } from '../routes/router';
import { useDesktopEventBridge } from '../features/runtime/queries';
import { useShellStore } from '../lib/store';

function DesktopRuntimeBridge() {
  const activeContextId = useShellStore((state) => state.activeContextId);
  useDesktopEventBridge(activeContextId);
  return null;
}

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <QueryClientProvider client={desktopQueryClient}>
      <DesktopRuntimeBridge />
      {children}
    </QueryClientProvider>
  );
}

export function RoutedApp() {
  return (
    <AppProviders>
      <RouterProvider router={desktopRouter} />
    </AppProviders>
  );
}
