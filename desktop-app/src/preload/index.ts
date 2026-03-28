import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopApi } from '../shared/contracts/api';
import { desktopChannels } from '../shared/ipc/channels';
import {
  ensureDaemonStatus,
  ensureEventMessage,
  ensureOptionalString,
  ensurePreferences,
  ensureRuntimeStatus,
  ensureString,
  ensureDesktopPosture
} from '../shared/ipc/validation';

const listeners = new Set<(event: ReturnType<typeof ensureEventMessage>) => void>();

ipcRenderer.on(desktopChannels.events.push, (_event, payload) => {
  const event = ensureEventMessage(payload);
  for (const listener of listeners) {
    listener(event);
  }
});

const desktopApi: DesktopApi = {
  app: {
    async getStatus() {
      return ensureDaemonStatus(await ipcRenderer.invoke(desktopChannels.app.status));
    },
    async getPosture() {
      return ensureDesktopPosture(await ipcRenderer.invoke(desktopChannels.app.posture));
    },
    async getVersion() {
      return ensureString(await ipcRenderer.invoke(desktopChannels.app.version), 'App version');
    }
  },
  daemon: {
    async call(method, params = {}) {
      return ipcRenderer.invoke(desktopChannels.daemon.call, ensureString(method, 'Daemon method'), params);
    }
  },
  runtime: {
    async refresh() {
      return ensureRuntimeStatus(await ipcRenderer.invoke(desktopChannels.runtime.refresh));
    },
    async getStatus() {
      return ensureRuntimeStatus(await ipcRenderer.invoke(desktopChannels.runtime.status));
    }
  },
  dialog: {
    async pickWorkspaceFolder() {
      return ensureOptionalString(await ipcRenderer.invoke(desktopChannels.dialog.pickWorkspaceFolder), 'Workspace folder') ?? null;
    }
  },
  shell: {
    async openPath(targetPath) {
      return ipcRenderer.invoke(desktopChannels.shell.openPath, ensureString(targetPath, 'Target path'));
    },
    async openExternal(targetUrl) {
      return ipcRenderer.invoke(desktopChannels.shell.openExternal, ensureString(targetUrl, 'Target URL'));
    }
  },
  events: {
    async start(contextId) {
      const payload = ensureOptionalString(contextId, 'Event contextId');
      return ipcRenderer.invoke(desktopChannels.events.start, payload);
    },
    async stop() {
      await ipcRenderer.invoke(desktopChannels.events.stop);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }
  },
  tray: {
    async show() {
      await ipcRenderer.invoke(desktopChannels.tray.show);
    }
  },
  preferences: {
    async get() {
      return ensurePreferences(await ipcRenderer.invoke(desktopChannels.preferences.get));
    },
    async update(patch) {
      return ensurePreferences(await ipcRenderer.invoke(desktopChannels.preferences.update, patch));
    }
  }
};

contextBridge.exposeInMainWorld('octxDesktop', desktopApi);

declare global {
  interface Window {
    octxDesktop: DesktopApi;
  }
}
