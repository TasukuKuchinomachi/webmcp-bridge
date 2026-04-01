import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  createSocketServer,
  type BridgeMessage,
  type ToolInfo,
} from "./socket.js";

/**
 * MCP サーバーを起動する。
 * - stdio で MCP クライアントと通信
 * - Unix socket で Native Host（Chrome 拡張）と通信
 */
export async function startMCPServer(): Promise<void> {
  // ツール名 → { tool情報, tabId } の逆引きマップ
  let toolMap = new Map<string, { tool: ToolInfo; tabId: number }>();

  // ツール呼び出しの pending リクエスト
  const pendingCalls = new Map<
    string,
    {
      resolve: (result: { content: Array<{ type: "text"; text: string }> }) => void;
      reject: (error: Error) => void;
    }
  >();

  // Native Host へメッセージを送る関数（接続後にセット）
  let sendToNativeHost: ((msg: BridgeMessage) => void) | null = null;

  // MCP サーバー
  const server = new Server(
    { name: "webmcp-bridge", version: "0.1.0" },
    { capabilities: { tools: { listChanged: true } } }
  );

  // Unix socket サーバー起動
  const { server: _socketServer } = createSocketServer((msg, send) => {
    sendToNativeHost = send;

    switch (msg.type) {
      case "tools-updated": {
        toolMap = new Map();
        for (const tool of msg.tools) {
          toolMap.set(tool.name, { tool, tabId: tool.tabId ?? 0 });
        }
        // MCP クライアントにツール一覧の変更を通知
        server.notification({
          method: "notifications/tools/list_changed",
        }).catch(() => {});
        break;
      }

      case "call-result": {
        const pending = pendingCalls.get(msg.id);
        if (pending) {
          pending.resolve(msg.result);
          pendingCalls.delete(msg.id);
        }
        break;
      }

      case "call-error": {
        const pending = pendingCalls.get(msg.id);
        if (pending) {
          pending.reject(new Error(msg.error));
          pendingCalls.delete(msg.id);
        }
        break;
      }
    }
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: Array.from(toolMap.values()).map(({ tool }) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: {
          type: "object" as const,
          ...tool.inputSchema,
        },
      })),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (!sendToNativeHost) {
      return {
        content: [{ type: "text", text: "Chrome extension is not connected" }],
        isError: true,
      };
    }

    const entry = toolMap.get(name);
    if (!entry) {
      return {
        content: [{ type: "text", text: `Tool "${name}" not found` }],
        isError: true,
      };
    }

    const id = crypto.randomUUID();

    const result = await new Promise<{
      content: Array<{ type: "text"; text: string }>;
    }>((resolve, reject) => {
      pendingCalls.set(id, { resolve, reject });

      sendToNativeHost!({
        type: "call-tool",
        id,
        name: entry.tool.originalName || entry.tool.name,
        args: (args ?? {}) as Record<string, unknown>,
        tabId: entry.tabId,
      });

      // タイムアウト 30秒
      setTimeout(() => {
        if (pendingCalls.has(id)) {
          pendingCalls.delete(id);
          reject(new Error(`Tool call "${name}" timed out`));
        }
      }, 30_000);
    });

    return result;
  });

  // stdio で MCP クライアントと接続
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
