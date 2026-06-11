import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Mirrors the tsconfig "@/*" -> "./*" path alias so lib/metrics imports resolve
// in tests the same way they do under Next.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
