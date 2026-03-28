import type { DesktopApi } from '../../shared/contracts/api';

function resolveDesktopApi(): DesktopApi {
  if (typeof window === 'undefined' || !window.octxDesktop) {
    throw new Error('Desktop API unavailable. Start the Electron shell.');
  }
  return window.octxDesktop;
}

export const desktopBridge = {
  app: {
    getStatus: () => resolveDesktopApi().app.getStatus(),
    getPosture: () => resolveDesktopApi().app.getPosture(),
    getVersion: () => resolveDesktopApi().app.getVersion()
  },
  daemon: {
    call: <T = unknown>(method: string, params: Record<string, unknown> = {}) => resolveDesktopApi().daemon.call<T>(method, params)
  },
  runtime: {
    refresh: () => resolveDesktopApi().runtime.refresh(),
    getStatus: () => resolveDesktopApi().runtime.getStatus()
  },
  dialog: {
    pickWorkspaceFolder: () => resolveDesktopApi().dialog.pickWorkspaceFolder()
  },
  shell: {
    openPath: (targetPath: string) => resolveDesktopApi().shell.openPath(targetPath),
    openExternal: (targetUrl: string) => resolveDesktopApi().shell.openExternal(targetUrl)
  },
  tray: {
    show: () => resolveDesktopApi().tray.show()
  },
  preferences: {
    get: () => resolveDesktopApi().preferences.get(),
    update: (patch: Parameters<DesktopApi['preferences']['update']>[0]) => resolveDesktopApi().preferences.update(patch)
  },
  events: {
    start: (contextId?: string | null) => resolveDesktopApi().events.start(contextId),
    stop: () => resolveDesktopApi().events.stop(),
    subscribe: (listener: Parameters<DesktopApi['events']['subscribe']>[0]) => resolveDesktopApi().events.subscribe(listener)
  }
};
