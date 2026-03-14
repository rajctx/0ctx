import path from 'node:path';
import { app, ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import { desktopChannels } from '../../shared/ipc/channels';
import type { DesktopEventMessage } from '../../shared/types/domain';
import { ConnectorService } from '../connector/connector-service';
import { DaemonService } from '../daemon/daemon-service';
import { DaemonClient } from '../daemon/ipc-client';
import { LocalGraphService } from '../daemon/local-graph-service';
import { buildOfflineDaemonFallback } from '../daemon/offline-fallbacks';
import { isDaemonUnavailableError } from '../daemon/ipc-client';
import { DesktopDialogService } from '../dialog/dialog-service';
import { DesktopEventsService } from '../events/events-service';
import { PreferencesService } from '../preferences/preferences-service';
import { DesktopShellService } from '../shell/shell-service';
import { DesktopTrayService } from '../tray/tray-service';
import { DesktopUpdaterService } from '../updater/updater-service';
import { createWindowManager } from '../windows/create-main-window';

export async function createDesktopApplication() {
  const singleInstance = app.requestSingleInstanceLock();
  if (!singleInstance) {
    app.quit();
    return;
  }

  const repoRoot = path.resolve(app.getAppPath(), '..');
  const preferences = new PreferencesService();
  const daemonRuntime = new DaemonService(repoRoot);
  const daemon = new DaemonClient();
  const localGraph = new LocalGraphService();
  const shell = new DesktopShellService();
  const dialog = new DesktopDialogService();
  const updater = new DesktopUpdaterService();
  const connector = new ConnectorService(repoRoot);
  const windows = createWindowManager(preferences);
  const events = new DesktopEventsService(daemon, (message: DesktopEventMessage) => {
    windows.broadcast(desktopChannels.events.push, message);
  });
  const tray = new DesktopTrayService({
    onShow: () => windows.showMainWindow(),
    onRestartConnector: () => {
      connector.restart();
    },
    onCheckUpdates: async () => {
      const result = await updater.checkForUpdates();
      windows.broadcast(desktopChannels.events.push, {
        kind: 'daemon-event',
        payload: {
          type: 'DesktopUpdateStatus',
          result
        }
      });
    }
  });

  let postureTimer: NodeJS.Timeout | null = null;

  const getMainWindow = (): BrowserWindow | null => windows.getMainWindow();

  const callWithDaemonRecovery = async <T>(operation: () => Promise<T>) => {
    try {
      return await operation();
    } catch (error) {
      if (!isDaemonUnavailableError(error)) {
        throw error;
      }

      const started = await daemonRuntime.ensureStarted(5_000).catch(() => false);
      if (!started) {
        throw error;
      }

      return operation();
    }
  };

  const refreshPosture = async () => {
    const posture = await callWithDaemonRecovery(() => daemon.getPosture()).catch(() => 'Offline' as const);
    tray.updatePosture(posture);
    windows.broadcast(desktopChannels.events.push, {
      kind: 'posture',
      posture
    });
  };

  const registerIpcHandlers = () => {
    ipcMain.handle(desktopChannels.app.status, () => callWithDaemonRecovery(() => daemon.getStatus()));
    ipcMain.handle(desktopChannels.app.posture, () => callWithDaemonRecovery(() => daemon.getPosture()));
    ipcMain.handle(desktopChannels.app.version, () => app.getVersion());
    ipcMain.handle(desktopChannels.daemon.call, async (_event, method: string, params: Record<string, unknown> = {}) => {
      const preferredLocalResult = localGraph.resolvePreferredRead(method, params);
      if (typeof preferredLocalResult !== 'undefined') {
        return preferredLocalResult;
      }

      try {
        const result = await callWithDaemonRecovery(() => daemon.call(method, params));
        return localGraph.resolveReadFallback(method, params, result);
      } catch (error) {
        if (isDaemonUnavailableError(error)) {
          const graphFallback = localGraph.resolveReadFallback(method, params);
          if (typeof graphFallback !== 'undefined') {
            return graphFallback;
          }
          const fallback = buildOfflineDaemonFallback(method, params);
          if (typeof fallback !== 'undefined') {
            return fallback;
          }
        }
        throw error;
      }
    });
    ipcMain.handle(desktopChannels.connector.restart, () => connector.restart());
    ipcMain.handle(desktopChannels.connector.status, () => connector.getStatus());
    ipcMain.handle(desktopChannels.dialog.pickWorkspaceFolder, () => dialog.pickWorkspaceFolder(getMainWindow()));
    ipcMain.handle(desktopChannels.shell.openPath, (_event, targetPath: string) => shell.openPath(targetPath));
    ipcMain.handle(desktopChannels.updates.check, () => updater.checkForUpdates());
    ipcMain.handle(desktopChannels.events.start, async (_event, contextId?: string | null) => {
      try {
        return await callWithDaemonRecovery(() => events.start(contextId));
      } catch (error) {
        if (isDaemonUnavailableError(error)) {
          return { subscriptionId: null };
        }
        throw error;
      }
    });
    ipcMain.handle(desktopChannels.events.stop, () => events.stop());
    ipcMain.handle(desktopChannels.tray.show, () => {
      windows.showMainWindow();
    });
    ipcMain.handle(desktopChannels.preferences.get, () => preferences.get());
    ipcMain.handle(desktopChannels.preferences.update, (_event, patch) => preferences.update(patch));
  };

  app.on('second-instance', () => {
    windows.showMainWindow();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('before-quit', () => {
    if (postureTimer) {
      clearInterval(postureTimer);
      postureTimer = null;
    }
    tray.destroy();
    localGraph.dispose();
    connector.dispose();
    events.dispose();
  });

  await app.whenReady();
  await daemonRuntime.ensureStarted().catch(() => false);
  registerIpcHandlers();
  windows.ensureMainWindow();
  tray.create();
  connector.start();
  await events.start(null).catch(() => ({ subscriptionId: null }));
  await refreshPosture();
  postureTimer = setInterval(() => {
    void refreshPosture();
  }, 8_000);

  app.on('activate', () => {
    windows.ensureMainWindow();
  });
}
