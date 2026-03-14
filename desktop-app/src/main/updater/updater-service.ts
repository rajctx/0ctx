import { autoUpdater } from 'electron-updater';
import type { UpdateStatus } from '../../shared/types/domain';

export class DesktopUpdaterService {
  private readonly feedUrl = String(process.env.OCTX_DESKTOP_UPDATE_URL || '').trim();

  constructor() {
    autoUpdater.autoDownload = false;
    if (this.feedUrl) {
      autoUpdater.setFeedURL({
        provider: 'generic',
        url: this.feedUrl
      });
    }
  }

  async checkForUpdates(): Promise<UpdateStatus> {
    if (!this.feedUrl) {
      return {
        state: 'idle',
        message: 'Updater feed is not configured for this build.'
      };
    }

    try {
      const result = await autoUpdater.checkForUpdates();
      const version = result?.updateInfo?.version ?? null;
      if (!version) {
        return {
          state: 'idle',
          message: 'You are on the latest desktop build.'
        };
      }

      return {
        state: 'available',
        message: `Update ${version} is available.`,
        version
      };
    } catch (error) {
      return {
        state: 'error',
        message: error instanceof Error ? error.message : String(error)
      };
    }
  }
}
