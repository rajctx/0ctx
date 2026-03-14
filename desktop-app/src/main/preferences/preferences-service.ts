import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { DesktopPreferences } from '../../shared/types/domain';

const defaultPreferences: DesktopPreferences = {
  theme: 'midnight',
  lastRoute: 'overview'
};

export class PreferencesService {
  private readonly filePath = path.join(app.getPath('userData'), 'preferences.json');

  get() {
    if (!fs.existsSync(this.filePath)) {
      return defaultPreferences;
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as Partial<DesktopPreferences>;
      return {
        theme: parsed.theme === 'dawn' ? 'dawn' : defaultPreferences.theme,
        lastRoute: typeof parsed.lastRoute === 'string' ? parsed.lastRoute : defaultPreferences.lastRoute
      } satisfies DesktopPreferences;
    } catch {
      return defaultPreferences;
    }
  }

  update(patch: Partial<DesktopPreferences>) {
    const next = {
      ...this.get(),
      ...patch
    } satisfies DesktopPreferences;

    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    return next;
  }
}
