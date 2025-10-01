import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    passWithNoTests: true,
    environment: "node", // default for backend/utils
    include: [
      "packages/**/src/**/*.test.{ts,tsx}",
      "examples/**/src/**/*.test.{ts,tsx}",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
    },
  },
});
