import { Menu, Tray, app } from 'electron';
import type { DesktopPosture } from '../../shared/types/domain';
import { createAppIcon } from '../app/app-icon';

interface TrayHandlers {
  onShow: () => void;
  onRefreshRuntime: () => void;
}

export class DesktopTrayService {
  private tray: Tray | null = null;
  private posture: DesktopPosture = 'Offline';

  constructor(private readonly handlers: TrayHandlers) {}

  create() {
    if (this.tray) {
      return this.tray;
    }

    this.tray = new Tray(createAppIcon(32));
    this.tray.setToolTip('0ctx Desktop');
    this.tray.on('double-click', this.handlers.onShow);
    this.refreshMenu();
    return this.tray;
  }

  updatePosture(posture: DesktopPosture) {
    this.posture = posture;
    if (this.tray) {
      this.tray.setToolTip(`0ctx Desktop · ${posture}`);
      this.refreshMenu();
    }
  }

  destroy() {
    this.tray?.destroy();
    this.tray = null;
  }

  private refreshMenu() {
    if (!this.tray) {
      return;
    }

    const menu = Menu.buildFromTemplate([
      {
        label: 'Open 0ctx Desktop',
        click: this.handlers.onShow
      },
      {
        label: `Status: ${this.posture}`,
        enabled: false
      },
      { type: 'separator' },
      {
        label: 'Refresh Local Runtime',
        click: this.handlers.onRefreshRuntime
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => app.quit()
      }
    ]);

    this.tray.setContextMenu(menu);
  }
}
