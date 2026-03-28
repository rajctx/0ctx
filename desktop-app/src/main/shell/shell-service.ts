import { shell } from 'electron';

export class DesktopShellService {
  async openPath(targetPath: string) {
    const candidate = String(targetPath || '').trim();
    if (!candidate) {
      throw new Error('Path is required.');
    }

    const error = await shell.openPath(candidate);
    if (error) {
      return {
        ok: false,
        message: error
      };
    }

    return {
      ok: true,
      message: `Opened ${candidate}`
    };
  }

  async openExternal(targetUrl: string) {
    const candidate = String(targetUrl || '').trim();
    if (!candidate) {
      throw new Error('URL is required.');
    }

    await shell.openExternal(candidate);
    return {
      ok: true,
      message: `Opened ${candidate}`
    };
  }
}
