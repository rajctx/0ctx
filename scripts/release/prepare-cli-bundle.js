#!/usr/bin/env node
/**
 * prepare-cli-bundle.js
 *
 * Copies workspace packages (@0ctx/core, @0ctx/daemon, @0ctx/mcp) into
 * packages/cli/node_modules so that npm pack honours bundleDependencies.
 *
 * npm workspaces hoist packages to the root node_modules via symlinks,
 * but npm pack ignores symlinks for bundleDependencies. This script
 * creates real copies instead.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const CLI_NM = path.join(ROOT, 'packages', 'cli', 'node_modules', '@0ctx');

const PACKAGES = ['core', 'daemon', 'mcp'];

// Clean previous copies
if (fs.existsSync(CLI_NM)) {
    fs.rmSync(CLI_NM, { recursive: true, force: true });
}
fs.mkdirSync(CLI_NM, { recursive: true });

for (const pkg of PACKAGES) {
    const src = path.join(ROOT, 'packages', pkg);
    const dest = path.join(CLI_NM, pkg);

    fs.mkdirSync(dest, { recursive: true });

    // Copy and strip package.json
    const pkgJsonPath = path.join(src, 'package.json');
    const pkgData = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
    delete pkgData.dependencies;
    delete pkgData.devDependencies;
    delete pkgData.peerDependencies;
    fs.writeFileSync(
        path.join(dest, 'package.json'),
        JSON.stringify(pkgData, null, 2)
    );

    // Copy dist/
    const distSrc = path.join(src, 'dist');
    if (!fs.existsSync(distSrc)) {
        console.error(`Missing dist for @0ctx/${pkg}. Run 'npm run build' first.`);
        process.exit(1);
    }
    copyDirSync(distSrc, path.join(dest, 'dist'));

    console.log(`  bundled @0ctx/${pkg}`);
}

console.log('CLI bundle prepared.');

function copyDirSync(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            copyDirSync(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}
