import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
    resolve: {
        alias: {
            '@/': path.resolve(__dirname, 'packages/ui/src') + '/'
        }
    },
    test: {
        environment: 'node',
        include: ['packages/*/test/**/*.test.ts'],
        reporters: ['default']
    }
});
