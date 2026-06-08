import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: ["apps/**/e2e/**/*.spec.ts", "packages/**/e2e/**/*.spec.ts"],
  testIgnore: [".worktrees/**", "**/node_modules/**", "**/dist/**", "**/build/**"],
  reporter: process.env.CI ? "github" : "list",
  use: {
    trace: "on-first-retry"
  }
});
