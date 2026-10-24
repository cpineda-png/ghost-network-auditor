import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    exclude: ["**/vendor/**", "**/node_modules/**"],
  },
});
