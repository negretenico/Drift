import { defineConfig, mergeConfig } from "vitest/config";
import baseConfig from "./vitest.config";

export default mergeConfig(baseConfig, {
  test: {
    environment: "jsdom", // DOM-like environment
    setupFiles: ["./test/setup-dom.ts"],
  },
});
