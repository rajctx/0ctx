const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const generatedDirs = [
  path.join(root, '.next', 'types'),
  path.join(root, '.next', 'dev', 'types'),
];

for (const dir of generatedDirs) {
  fs.rmSync(dir, { recursive: true, force: true });
}
