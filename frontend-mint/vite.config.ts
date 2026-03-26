import { resolve } from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig({
  base: '/mint/',
  server: {
    allowedHosts: true,
  },
  plugins: [
    // nodePolyfills MUST come before react()
    nodePolyfills({
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
      overrides: {
        crypto: 'crypto-browserify', // Required for signing
      },
    }),
    react(),
  ],
  resolve: {
    alias: {
      global: 'global',
      // opnet uses undici internally — needs browser shim
      undici: resolve(__dirname, 'node_modules/opnet/src/fetch/fetch-browser.js'),
    },
    mainFields: ['module', 'main', 'browser'],
    dedupe: ['@noble/curves', '@noble/hashes', '@scure/base', 'buffer', 'react', 'react-dom'],
  },
  optimizeDeps: {
    exclude: ['crypto-browserify'],
  },
  build: {
    outDir: '../frontend-build',
    emptyOutDir: true,
    commonjsOptions: {
      strictRequires: true,
      transformMixedEsModules: true,
    },
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('crypto-browserify') || id.includes('randombytes')) return undefined;
          if (id.includes('node_modules')) {
            if (id.includes('@noble/curves')) return 'noble-curves';
            if (id.includes('@noble/hashes')) return 'noble-hashes';
            if (id.includes('@scure/')) return 'scure';
            if (id.includes('@btc-vision/transaction')) return 'btc-transaction';
            if (id.includes('@btc-vision/bitcoin')) return 'btc-bitcoin';
            if (id.includes('@btc-vision/post-quantum')) return 'btc-post-quantum';
            if (id.includes('@btc-vision/walletconnect')) return 'btc-walletconnect';
            if (id.includes('node_modules/opnet')) return 'opnet';
            if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/')) return 'react-ui';
          }
        },
      },
    },
  },
});
