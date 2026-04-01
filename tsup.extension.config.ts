import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["extension/content-main.ts"],
  format: ["iife"],
  outDir: "extension/dist",
  platform: "browser",
  target: "chrome116",
  splitting: false,
  dts: false,
  sourcemap: false,
  clean: true,
});
