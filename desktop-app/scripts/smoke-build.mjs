#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    shell: process.platform === 'win32',
    stdio: 'inherit'
  });

  if ((result.status ?? 1) !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed`);
  }
}

run('npm', ['run', 'build']);

const required = [
  path.join(root, 'dist-renderer', 'index.html'),
  path.join(root, 'dist-electron', 'main', 'bootstrap', 'index.js'),
  path.join(root, 'dist-electron', 'preload', 'index.js')
];

for (const file of required) {
  if (!fs.existsSync(file)) {
    throw new Error(`Missing build artifact: ${file}`);
  }
}

console.log('Electron desktop smoke build completed.');
