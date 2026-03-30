#!/usr/bin/env node

import { startMCPServer } from "./mcp-server.js";
import { startNativeHost } from "./native-host.js";
import { installManifest } from "./postinstall.js";

const args = process.argv.slice(2);

if (args.includes("--native-host")) {
  // Chrome が Native Messaging で起動するモード
  startNativeHost().catch((e) => {
    process.stderr.write(`[webmcp-bridge] native host error: ${e}\n`);
    process.exit(1);
  });
} else if (args.includes("--install")) {
  // Native Messaging マニフェストを手動登録
  installManifest();
} else {
  // デフォルト: MCP サーバーモード（MCP クライアントが起動）
  startMCPServer().catch((e) => {
    process.stderr.write(`[webmcp-bridge] server error: ${e}\n`);
    process.exit(1);
  });
}
