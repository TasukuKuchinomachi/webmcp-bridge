import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// Chrome 拡張の ID（公開後に確定。開発中は chrome://extensions から取得）
const EXTENSION_ID = "EXTENSION_ID_PLACEHOLDER";

const MANIFEST_NAME = "com.webmcp.bridge";

interface NativeMessagingManifest {
  name: string;
  description: string;
  path: string;
  type: "stdio";
  allowed_origins: string[];
}

function getManifestDir(): string {
  switch (process.platform) {
    case "darwin":
      return path.join(
        os.homedir(),
        "Library/Application Support/Google/Chrome/NativeMessagingHosts"
      );
    case "linux":
      return path.join(os.homedir(), ".config/google-chrome/NativeMessagingHosts");
    case "win32":
      // Windows は レジストリ登録が必要だが、まずファイル配置のみ
      return path.join(
        process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData/Local"),
        "Google/Chrome/User Data/NativeMessagingHosts"
      );
    default:
      throw new Error(`Unsupported platform: ${process.platform}`);
  }
}

function findBinaryPath(): string {
  // npm i -g でインストールされたバイナリのパスを特定
  const binPath = process.argv[1];
  if (binPath && fs.existsSync(binPath)) {
    return fs.realpathSync(binPath);
  }

  // フォールバック: which webmcp-bridge
  const { execSync } = require("node:child_process");
  try {
    return execSync("which webmcp-bridge", { encoding: "utf-8" }).trim();
  } catch {
    // 開発中のパス
    return path.resolve(process.cwd(), "dist/index.js");
  }
}

/**
 * ラッパースクリプトを生成する。
 * Native Messaging Host は shebang 付きの直接実行可能ファイルが必要。
 */
function createWrapper(): string {
  const wrapperDir = path.join(os.homedir(), ".webmcp-bridge");
  fs.mkdirSync(wrapperDir, { recursive: true });

  const wrapperPath = path.join(wrapperDir, "native-host");
  const binPath = findBinaryPath();

  const content = `#!/bin/sh\nexec node "${binPath}" --native-host\n`;
  fs.writeFileSync(wrapperPath, content, { mode: 0o755 });

  return wrapperPath;
}

export function installManifest(): void {
  try {
    const manifestDir = getManifestDir();
    fs.mkdirSync(manifestDir, { recursive: true });

    const wrapperPath = createWrapper();

    const manifest: NativeMessagingManifest = {
      name: MANIFEST_NAME,
      description: "WebMCP Bridge — expose WebMCP tools as MCP tools",
      path: wrapperPath,
      type: "stdio",
      allowed_origins: [`chrome-extension://${EXTENSION_ID}/`],
    };

    const manifestPath = path.join(manifestDir, `${MANIFEST_NAME}.json`);
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    process.stderr.write(
      `[webmcp-bridge] Native messaging manifest installed: ${manifestPath}\n`
    );
    process.stderr.write(
      `[webmcp-bridge] Wrapper script: ${wrapperPath}\n`
    );
  } catch (e) {
    process.stderr.write(
      `[webmcp-bridge] Failed to install manifest: ${e}\n`
    );
  }
}

// postinstall スクリプトとして直接実行された場合
const isDirectRun =
  process.argv[1]?.endsWith("postinstall.js") ||
  process.argv.includes("--install");
if (isDirectRun) {
  installManifest();
}
