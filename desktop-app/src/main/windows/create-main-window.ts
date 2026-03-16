import path from 'node:path';
import { app, BrowserWindow } from 'electron';
import { createAppIcon } from '../app/app-icon';
import { PreferencesService } from '../preferences/preferences-service';

interface WindowManager {
  ensureMainWindow(): BrowserWindow;
  getMainWindow(): BrowserWindow | null;
  showMainWindow(): void;
  broadcast(channel: string, payload: unknown): void;
}

export function createWindowManager(preferences: PreferencesService): WindowManager {
  let mainWindow: BrowserWindow | null = null;

  const createWindow = () => {
    const preference = preferences.get();
    const routeHash = preference.lastRoute ? `#/${preference.lastRoute}` : '#/overview';
    mainWindow = new BrowserWindow({
      width: 1480,
      height: 980,
      minWidth: 1180,
      minHeight: 780,
      show: false,
      backgroundColor: '#0b1020',
      title: '0ctx Desktop',
      icon: createAppIcon(128),
      titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
      webPreferences: {
        contextIsolation: true,
        sandbox: false,
        preload: path.join(app.getAppPath(), 'dist-electron', 'preload', 'index.js')
      }
    });

    if (process.env.OCTX_ELECTRON_DEV_SERVER_URL) {
      void mainWindow.loadURL(`${process.env.OCTX_ELECTRON_DEV_SERVER_URL}${routeHash}`);
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    } else {
      void mainWindow.loadFile(path.join(app.getAppPath(), 'dist-renderer', 'index.html'), {
        hash: routeHash.replace(/^#/, '')
      });
    }

    mainWindow.once('ready-to-show', () => {
      mainWindow?.show();
    });

    mainWindow.on('closed', () => {
      mainWindow = null;
    });

    return mainWindow;
  };

  return {
    ensureMainWindow() {
      return mainWindow && !mainWindow.isDestroyed() ? mainWindow : createWindow();
    },
    getMainWindow() {
      return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
    },
    showMainWindow() {
      const window = mainWindow && !mainWindow.isDestroyed() ? mainWindow : createWindow();
      if (window.isMinimized()) {
        window.restore();
      }
      window.show();
      window.focus();
    },
    broadcast(channel, payload) {
      const window = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
      if (!window) {
        return;
      }
      window.webContents.send(channel, payload);
    }
  };
}
