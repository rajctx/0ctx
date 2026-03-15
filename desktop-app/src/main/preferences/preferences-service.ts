import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { app } from 'electron';
import type { DesktopPreferences } from '../../shared/types/domain';

const defaultPreferences: DesktopPreferences = {
  theme: 'midnight',
  lastRoute: 'overview'
};

export class PreferencesService {
  private readonly filePath = path.join(app.getPath('userData'), 'preferences.json');
  private cachedPreferences: DesktopPreferences | null = null;

  get() {
    if (this.cachedPreferences) {
      return this.cachedPreferences;
    }

    if (!fs.existsSync(this.filePath)) {
      this.cachedPreferences = defaultPreferences;
      return this.cachedPreferences;
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as Partial<DesktopPreferences>;
      this.cachedPreferences = {
        theme: parsed.theme === 'dawn' ? 'dawn' : defaultPreferences.theme,
        lastRoute: typeof parsed.lastRoute === 'string' ? parsed.lastRoute : defaultPreferences.lastRoute
      } satisfies DesktopPreferences;
      return this.cachedPreferences;
    } catch {
      this.cachedPreferences = defaultPreferences;
      return this.cachedPreferences;
    }
  }

  async update(patch: Partial<DesktopPreferences>) {
    const next = {
      ...this.get(),
      ...patch
    } satisfies DesktopPreferences;

    await fsp.mkdir(path.dirname(this.filePath), { recursive: true });
    await fsp.writeFile(this.filePath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    this.cachedPreferences = next;
    return next;
  }
}
