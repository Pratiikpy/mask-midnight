import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // The router is pure and the notifier is driven by hand, so nothing here
    // waits on a network. A slow test means a real bug, not a slow chain.
    testTimeout: 5_000,
  },
});
