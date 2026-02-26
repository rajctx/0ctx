const fs = require('fs');
const path = require('path');

const uiDir = path.resolve(__dirname, '..');
const standaloneDir = path.resolve(uiDir, '.next/standalone/packages/ui');

if (!fs.existsSync(standaloneDir)) {
    console.error('Standalone dir not found. Did you run `next build` with `output: "standalone"`?');
    process.exit(1);
}

// Copy public/
const publicSrc = path.resolve(uiDir, 'public');
const publicDest = path.resolve(standaloneDir, 'public');

if (fs.existsSync(publicSrc)) {
    fs.cpSync(publicSrc, publicDest, { recursive: true });
}

// Copy .next/static/
const staticSrc = path.resolve(uiDir, '.next/static');
const staticDest = path.resolve(standaloneDir, '.next/static');

if (fs.existsSync(staticSrc)) {
    fs.cpSync(staticSrc, staticDest, { recursive: true });
}

console.log('Successfully copied public and static assets to standalone build.');
