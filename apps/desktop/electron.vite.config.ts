import { resolve } from 'path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

/**
 * 构建配置
 * 关键点：core 与 llm 直接引用源码（不预编译），避免多一次构建步骤，
 * 同时保证它们不依赖 Electron，将来可独立发布。
 */
export default defineConfig({
    main: {
        resolve: {
            alias: {
                '@mojiang/core': resolve(__dirname, '../../packages/core/src/index.ts'),
                '@mojiang/llm': resolve(__dirname, '../../packages/llm/src/index.ts'),
                '@main': resolve(__dirname, 'src/main'),
            },
        },
        build: {
            rollupOptions: {
                input: { index: resolve(__dirname, 'src/main/index.ts') },
            },
        },
    },
    preload: {
        resolve: {
            alias: {
                '@main': resolve(__dirname, 'src/main'),
            },
        },
        build: {
            rollupOptions: {
                input: { index: resolve(__dirname, 'src/preload/index.ts') },
            },
        },
    },
    renderer: {
        root: resolve(__dirname, 'src/renderer'),
        resolve: {
            alias: {
                '@': resolve(__dirname, 'src/renderer/src'),
                '@shared': resolve(__dirname, 'src/shared'),
                '@mojiang/core': resolve(__dirname, '../../packages/core/src/index.ts'),
                '@mojiang/llm': resolve(__dirname, '../../packages/llm/src/index.ts'),
            },
        },
        build: {
            rollupOptions: {
                input: { index: resolve(__dirname, 'src/renderer/index.html') },
            },
        },
        plugins: [react()],
    },
});
