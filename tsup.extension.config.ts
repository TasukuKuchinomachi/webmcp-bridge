import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "extension/background.ts",
    "extension/content-main.ts",
    "extension/content-isolated.ts",
  ],
  format: ["iife"],
  outDir: "extension/dist",
  platform: "browser",
  target: "chrome116",
  splitting: false,
  dts: false,
  sourcemap: false,
  clean: true,
});
