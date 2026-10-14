import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Same "@/…" alias as tsconfig.json, so component tests can render components that import from "@/lib/…".
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
});
