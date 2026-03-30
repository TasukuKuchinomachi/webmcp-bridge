import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/postinstall.ts"],
  format: ["esm"],
  target: "node22",
  platform: "node",
  dts: false,
  sourcemap: true,
  clean: true,
});
