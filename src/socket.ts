import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/** MCP サーバー ↔ Native Host 間のメッセージ型 */
export type BridgeMessage =
  | { type: "tools-updated"; tools: ToolInfo[] }
  | { type: "call-tool"; id: string; name: string; args: Record<string, unknown>; tabId?: number }
  | { type: "call-result"; id: string; result: { content: Array<{ type: "text"; text: string }> } }
  | { type: "call-error"; id: string; error: string };

export interface ToolInfo {
  name: string;
  originalName?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  tabId?: number;
}

const SOCKET_DIR = path.join(os.homedir(), ".webmcp-bridge");
const SOCKET_PATH = path.join(SOCKET_DIR, "bridge.sock");

export function getSocketPath(): string {
  return SOCKET_PATH;
}

function ensureSocketDir(): void {
  fs.mkdirSync(SOCKET_DIR, { recursive: true });
}

function cleanupSocket(): void {
  try {
    fs.unlinkSync(SOCKET_PATH);
  } catch {
    // ignore
  }
}

/**
 * Unix socket サーバーを起動（MCP サーバー側で使用）。
 * Native Host からの接続を受け付ける。
 */
export function createSocketServer(
  onMessage: (msg: BridgeMessage, send: (msg: BridgeMessage) => void) => void
): { server: net.Server; waitForConnection: () => Promise<void> } {
  ensureSocketDir();
  cleanupSocket();

  let resolveConnection: () => void;
  const connectionPromise = new Promise<void>((r) => {
    resolveConnection = r;
  });

  const server = net.createServer((conn) => {
    resolveConnection();
    let buffer = "";

    conn.on("data", (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop()!;
      for (const line of lines) {
        if (line.trim()) {
          try {
            const parsed = JSON.parse(line);
            onMessage(parsed, (msg) => {
              conn.write(JSON.stringify(msg) + "\n");
            });
          } catch {
            // ignore parse errors
          }
        }
      }
    });
  });

  server.listen(SOCKET_PATH);

  process.on("exit", () => cleanupSocket());
  process.on("SIGINT", () => {
    cleanupSocket();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    cleanupSocket();
    process.exit(0);
  });

  return { server, waitForConnection: () => connectionPromise };
}

/**
 * Unix socket に接続（Native Host 側で使用）。
 * MCP サーバーとメッセージを交換する。
 */
export function connectToSocket(
  onMessage: (msg: BridgeMessage, send: (msg: BridgeMessage) => void) => void
): Promise<{ send: (msg: BridgeMessage) => void }> {
  return new Promise((resolve, reject) => {
    const conn = net.createConnection(SOCKET_PATH, () => {
      const send = (msg: BridgeMessage) => {
        conn.write(JSON.stringify(msg) + "\n");
      };

      let buffer = "";
      conn.on("data", (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop()!;
        for (const line of lines) {
          if (line.trim()) {
            try {
              onMessage(JSON.parse(line), send);
            } catch {
              // ignore parse errors
            }
          }
        }
      });

      resolve({ send });
    });

    conn.on("error", reject);
  });
}
