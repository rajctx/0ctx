import type { BrowserWindow, OpenDialogOptions } from 'electron';
import { dialog } from 'electron';

export class DesktopDialogService {
  async pickWorkspaceFolder(window: BrowserWindow | null) {
    const options: OpenDialogOptions = {
      title: 'Select workspace folder',
      properties: ['openDirectory', 'createDirectory']
    };

    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);

    if (result.canceled) {
      return null;
    }

    return result.filePaths[0] ?? null;
  }
}
