import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
    resolve: {
        alias: [
            {
                find: /^@\/(.*)$/,
                replacement: path.resolve(__dirname, 'packages/ui/src') + '/$1'
            },
            {
                find: /^@0ctx\/core$/,
                replacement: path.resolve(__dirname, 'packages/core/src/index.ts')
            },
            {
                find: /^@0ctx\/core\/(.+)$/,
                replacement: path.resolve(__dirname, 'packages/core/src') + '/$1'
            },
            {
                find: /^@0ctx\/daemon$/,
                replacement: path.resolve(__dirname, 'packages/daemon/src/index.ts')
            },
            {
                find: /^@0ctx\/daemon\/(.+)$/,
                replacement: path.resolve(__dirname, 'packages/daemon/src') + '/$1'
            },
            {
                find: /^@0ctx\/mcp$/,
                replacement: path.resolve(__dirname, 'packages/mcp/src/index.ts')
            },
            {
                find: /^@0ctx\/mcp\/dist\/(.+)$/,
                replacement: path.resolve(__dirname, 'packages/mcp/src') + '/$1'
            },
            {
                find: /^@0ctx\/mcp\/(.+)$/,
                replacement: path.resolve(__dirname, 'packages/mcp/src') + '/$1'
            }
        ]
    },
    test: {
        environment: 'node',
        include: ['packages/*/test/**/*.test.ts'],
        reporters: ['default']
    }
});
