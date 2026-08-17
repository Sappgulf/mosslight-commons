import { defineConfig } from "vite";

export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: 4173,
  },
  build: {
    rollupOptions: {
      output: {
        // Phaser is by far the largest dependency and changes far less often
        // than game code, so give it its own long-lived chunk instead of
        // reshipping it with every gameplay tweak. Vite 8 builds on rolldown,
        // which only accepts the function form here.
        manualChunks: (id: string) => (id.includes("node_modules/phaser") ? "phaser" : undefined),
      },
    },
    chunkSizeWarningLimit: 1500,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Several simulation tests play a full game out — 1600 ticks of a real
    // settlement — which legitimately takes seconds. At the 5s default they
    // passed alone and timed out under parallel load, so the suite failed on
    // machine load rather than on behaviour.
    testTimeout: 60000,
  },
});
