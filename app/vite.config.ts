import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import wasm from 'vite-plugin-wasm';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { viteCommonjs } from '@originjs/vite-plugin-commonjs';

// The Midnight SDK is WASM-backed and was built for Node, so the browser build
// needs all six of these. Dropping any one produces a runtime failure rather
// than a build error, which makes them easy to lose track of:
//
//   wasm                   the ledger and onchain-runtime are WASM modules
//   nodePolyfills          the SDK reaches for buffer/process/crypto/stream
//   commonjs               some transitive deps ship CJS only
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    wasm(),
    nodePolyfills({
      include: ['buffer', 'process', 'util', 'stream', 'crypto', 'events'],
      globals: { Buffer: true, global: true, process: true },
    }),
    viteCommonjs(),
  ],
  build: {
    // Top-level await is used by the WASM modules and is supported natively by
    // every browser this app can run in — Lace itself requires a modern one.
    //
    // The alternative was vite-plugin-top-level-await, which transforms TLA away
    // for older targets. It was here, and it broke the production build outright
    // with `[vite-plugin-top-level-await] missing field \`type\`` out of SWC.
    // Targeting esnext removes the need for the transform rather than working
    // around a bug in it.
    target: 'esnext',
    // The browser suite exercises demo mode, which generates no proofs and so
    // never reads the 233 MB of proving keys in public/. MASK_NO_KEYS=1 leaves
    // them out of that build, which is the difference between a test build that
    // takes seconds and one that copies a quarter of a gigabyte across the
    // Windows mount.
    copyPublicDir: process.env.MASK_NO_KEYS !== '1',
  },
  resolve: {
    alias: {
      // The compiled contract lives outside this package and imports
      // @midnight-ntwrk/compact-runtime, which Node resolves from the *devkit's*
      // module tree. That copy's zswap.js imports these shims — and the devkit
      // has no reason to have a Vite plugin installed, so Rollup could not
      // resolve them and the production build failed outright:
      //
      //   Rollup failed to resolve import "vite-plugin-node-polyfills/shims/buffer"
      //
      // Dev never hit it, because Vite serves those specifiers itself. Pinning
      // them to this package's copies fixes the build without installing a
      // frontend plugin into a backend tree.
      // The compiled contract is imported from outside this package, so Node
      // resolves ITS dependencies from the devkit's module tree — a second copy
      // of compact-runtime, ledger and onchain-runtime, each with its own WASM
      // instance. The app then holds a value made by one and checks it against
      // the other, and the production bundle failed at runtime with
      //
      //   expected instance of Oi
      //
      // which is `ChargedState` after minification. Dev avoided it because
      // optimizeDeps.include pre-bundles the app's copies and Vite serves those
      // to everyone; the build has no such step, so the aliases are what make
      // one copy win.
      '@midnight-ntwrk/compact-runtime': fileURLToPath(
        new URL('./node_modules/@midnight-ntwrk/compact-runtime', import.meta.url),
      ),
      '@midnight-ntwrk/ledger-v8': fileURLToPath(
        new URL('./node_modules/@midnight-ntwrk/ledger-v8', import.meta.url),
      ),
      '@midnight-ntwrk/onchain-runtime-v3': fileURLToPath(
        new URL('./node_modules/@midnight-ntwrk/onchain-runtime-v3', import.meta.url),
      ),
      'vite-plugin-node-polyfills/shims/buffer': fileURLToPath(
        new URL('./node_modules/vite-plugin-node-polyfills/shims/buffer/dist/index.js', import.meta.url),
      ),
      'vite-plugin-node-polyfills/shims/global': fileURLToPath(
        new URL('./node_modules/vite-plugin-node-polyfills/shims/global/dist/index.js', import.meta.url),
      ),
      'vite-plugin-node-polyfills/shims/process': fileURLToPath(
        new URL('./node_modules/vite-plugin-node-polyfills/shims/process/dist/index.js', import.meta.url),
      ),
    },
  },
  server: {
    port: 5175,
    // Proving keys are served from public/ and fetched by the zk config
    // provider at call time.
    fs: { allow: ['..'] },
    // The dev server runs inside WSL while the sources live on the Windows
    // filesystem, and inotify does not cross the 9p mount — so the watcher sees
    // no events at all and every edit appears to do nothing. Polling is the
    // only thing that works there. It costs a little CPU and saves the far more
    // expensive mistake of debugging a page that never reloaded.
    watch: { usePolling: true, interval: 300 },
  },
  // These must be pre-bundled, not excluded. Excluding them serves them as raw
  // ESM while the rest of the SDK is pre-bundled, producing two instances of
  // the same WASM module — and `instanceof ChargedState` then fails across the
  // boundary with "expected instance of ChargedState". Same class of bug as the
  // duplicated onchain-runtime in the devkit.
  optimizeDeps: {
    esbuildOptions: { target: 'esnext' },
    include: [
      '@midnight-ntwrk/onchain-runtime-v3',
      '@midnight-ntwrk/ledger-v8',
      '@midnight-ntwrk/compact-runtime',
      '@midnight-ntwrk/midnight-js-protocol',
      '@midnight-ntwrk/midnight-js-contracts',
      '@midnight-ntwrk/midnight-js-indexer-public-data-provider',
    ],
  },
});
