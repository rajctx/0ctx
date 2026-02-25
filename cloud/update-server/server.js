#!/usr/bin/env node
/**
 * DX-02: Tauri auto-update manifest server.
 *
 * Serves JSON update manifests matching the Tauri v2 updater protocol.
 * In production, reads from S3-compatible URL. In dev, reads from local releases/ directory.
 *
 * Tauri updater protocol:
 *   GET /:target/:arch/:current_version
 *   Returns 200 with update manifest or 204 if no update available.
 *
 * Usage:
 *   node server.js
 *   PORT=8888 RELEASES_DIR=./releases node server.js
 *   S3_RELEASES_URL=https://releases.0ctx.com node server.js
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 8888);
const HOST = process.env.HOST || '127.0.0.1';
const RELEASES_DIR = process.env.RELEASES_DIR || path.join(__dirname, 'releases');
const S3_RELEASES_URL = process.env.S3_RELEASES_URL || '';

// Ensure releases directory exists
if (!S3_RELEASES_URL && !fs.existsSync(RELEASES_DIR)) {
  fs.mkdirSync(RELEASES_DIR, { recursive: true });
}

/**
 * Read the latest release manifest from local directory.
 * Expected file structure:
 *   releases/
 *     latest.json           — { version, notes, pub_date, platforms }
 *     0ctx-desktop_0.2.0_x64-setup.nsis.zip
 *     0ctx-desktop_0.2.0_x64-setup.nsis.zip.sig
 */
function getLocalManifest() {
  const manifestPath = path.join(RELEASES_DIR, 'latest.json');
  if (!fs.existsSync(manifestPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Fetch release manifest from S3-compatible URL.
 */
async function getRemoteManifest() {
  if (!S3_RELEASES_URL) return null;
  try {
    const res = await fetch(`${S3_RELEASES_URL}/latest.json`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Compare semver strings. Returns true if available > current.
 */
function isNewer(available, current) {
  const parse = (v) => v.replace(/^v/, '').split('.').map(Number);
  const a = parse(available);
  const c = parse(current);
  for (let i = 0; i < 3; i++) {
    if ((a[i] || 0) > (c[i] || 0)) return true;
    if ((a[i] || 0) < (c[i] || 0)) return false;
  }
  return false;
}

/**
 * Map Tauri target/arch to platform key.
 * Tauri sends: target=windows/linux/darwin, arch=x86_64/aarch64
 */
function platformKey(target, arch) {
  const os = target.includes('windows') ? 'windows' : target.includes('darwin') ? 'darwin' : 'linux';
  return `${os}-${arch}`;
}

const server = http.createServer(async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Parse: /:target/:arch/:current_version
  const parts = (req.url || '/').split('/').filter(Boolean);

  if (parts.length < 3) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Expected /:target/:arch/:current_version' }));
    return;
  }

  const [target, arch, currentVersion] = parts;

  // Get manifest
  const manifest = S3_RELEASES_URL ? await getRemoteManifest() : getLocalManifest();

  if (!manifest || !manifest.version) {
    // No update available
    res.writeHead(204);
    res.end();
    return;
  }

  // Check if update is newer
  if (!isNewer(manifest.version, currentVersion)) {
    res.writeHead(204);
    res.end();
    return;
  }

  // Find platform-specific entry
  const key = platformKey(target, arch);
  const platform = manifest.platforms?.[key];

  if (!platform) {
    // No build for this platform
    res.writeHead(204);
    res.end();
    return;
  }

  // Return Tauri updater response
  const response = {
    version: manifest.version,
    notes: manifest.notes || '',
    pub_date: manifest.pub_date || new Date().toISOString(),
    url: platform.url,
    signature: platform.signature || ''
  };

  const body = JSON.stringify(response, null, 2);
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
});

server.listen(PORT, HOST, () => {
  console.log(`0ctx update server listening on http://${HOST}:${PORT}`);
  console.log(`Source: ${S3_RELEASES_URL || RELEASES_DIR}`);
  console.log(`\nEndpoint: GET /:target/:arch/:current_version`);
  console.log(`Example: curl http://${HOST}:${PORT}/windows-x86_64/x86_64/0.1.0`);
});
