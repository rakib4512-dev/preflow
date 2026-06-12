import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: "node",
    include: ["app/**/__tests__/**/*.test.ts", "app/**/*.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
  },
});
