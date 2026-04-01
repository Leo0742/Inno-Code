import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@inno/engine": path.resolve(__dirname, "../../packages/engine/src/index.ts")
    }
  }
});
