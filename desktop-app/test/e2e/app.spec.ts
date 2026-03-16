import path from 'node:path';
import { test, expect, _electron as electron } from '@playwright/test';

test('desktop shell renders the title bar', async () => {
  const app = await electron.launch({
    args: ['.'],
    cwd: path.resolve(__dirname, '..', '..')
  });

  const window = await app.firstWindow();
  await expect(window).toHaveTitle(/0ctx Desktop/i);
  await app.close();
});
