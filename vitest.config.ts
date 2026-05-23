import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    maxWorkers: 2,
    include: [
      "apps/**/*.{test,spec}.{ts,tsx}",
      "packages/**/*.{test,spec}.{ts,tsx}"
    ],
    exclude: [
      "**/e2e/**",
      "**/node_modules/**"
    ],
    passWithNoTests: true
  }
});
