/**
 * esbuild bundle script for @0ctx/cli
 *
 * Produces a single self-contained dist/index.js that compiles and inlines
 * all workspace packages (@0ctx/core, @0ctx/daemon, @0ctx/mcp) directly
 * from their TypeScript source — no separate tsc pre-build needed.
 *
 * External (kept as runtime node_modules deps):
 *   - better-sqlite3   — native Node addon (.node binary)
 */

// esbuild is installed at the monorepo root — Node's module resolution walks
// up from packages/cli/ and finds it in ../../node_modules automatically.
import esbuild from 'esbuild';
import { mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '../..');

const dist = resolve(__dirname, 'dist');
if (!existsSync(dist)) mkdirSync(dist);

// ── Workspace package aliases ────────────────────────────────────────────────
// Point @0ctx/* imports directly at TypeScript source so esbuild compiles and
// bundles them without needing a separate tsc step first.
//
// Sub-path imports like `@0ctx/mcp/dist/bootstrap` are also aliased so the
// /dist/ path segment (used in the published package) maps to the src/ file.

const alias = {
  // Top-level package entries
  '@0ctx/core':              resolve(root, 'packages/core/src/index.ts'),
  '@0ctx/daemon':            resolve(root, 'packages/daemon/src/index.ts'),
  '@0ctx/mcp':               resolve(root, 'packages/mcp/src/index.ts'),

  // Sub-path imports used by CLI (from packages/cli/src/index.ts)
  '@0ctx/mcp/dist/bootstrap': resolve(root, 'packages/mcp/src/bootstrap.ts'),
  '@0ctx/mcp/dist/client':    resolve(root, 'packages/mcp/src/client.ts'),
};

console.log('→ Bundling @0ctx/cli (esbuild)...');

await esbuild.build({
  entryPoints: [resolve(__dirname, 'src/index.ts')],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  outfile: resolve(__dirname, 'dist/index.js'),

  // Workspace packages resolved above via alias
  alias,

  // Native addons that cannot be inlined — must remain in node_modules
  external: [
    'better-sqlite3',
  ],

  // Inline source-map for better stack traces without extra files
  sourcemap: 'inline',

  // Note: esbuild 0.27+ preserves the shebang from src/index.ts automatically.
  // Do NOT add a banner here — it would produce a duplicate shebang and a
  // "SyntaxError: Invalid or unexpected token" when running with `node`.

  logLevel: 'info',
});

console.log('→ Bundling @0ctx/mcp server runtime for CLI package...');

await esbuild.build({
  entryPoints: [resolve(root, 'packages/mcp/src/index.ts')],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  outfile: resolve(__dirname, 'dist/mcp-server.js'),
  alias,
  external: [
    'better-sqlite3',
  ],
  sourcemap: 'inline',
  logLevel: 'info',
});

console.log('→ Bundling @0ctx/daemon runtime for CLI package...');

await esbuild.build({
  entryPoints: [resolve(root, 'packages/daemon/src/index.ts')],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  outfile: resolve(__dirname, 'dist/daemon.js'),
  alias,
  external: [
    'better-sqlite3',
  ],
  sourcemap: 'inline',
  logLevel: 'info',
});

console.log('✓ dist/index.js, dist/mcp-server.js, and dist/daemon.js ready');
