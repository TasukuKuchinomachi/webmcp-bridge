/**
 * MAIN world content script
 * ページの navigator.modelContext.registerTool を monkey-patch して
 * ツール登録を捕捉し、ISOLATED world に通知する。
 */

const TOOLS: Record<
  string,
  {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    execute: (params: Record<string, unknown>) => Promise<unknown>;
  }
> = {};

function notifyToolsUpdated(): void {
  const toolInfos = Object.values(TOOLS).map(({ name, description, inputSchema }) => ({
    name,
    description,
    inputSchema,
  }));
  window.postMessage(
    { source: "webmcp-bridge-main", type: "tools-updated", tools: toolInfos },
    "*"
  );
}

function patchModelContext(mc: any): void {
  if (mc.__webmcp_bridge_patched) return;
  mc.__webmcp_bridge_patched = true;

  const origRegister = mc.registerTool.bind(mc);
  const origUnregister = mc.unregisterTool.bind(mc);

  mc.registerTool = function (tool: any) {
    TOOLS[tool.name] = {
      name: tool.name,
      description: tool.description || "",
      inputSchema: tool.inputSchema ? JSON.parse(JSON.stringify(tool.inputSchema)) : {},
      execute: tool.execute,
    };
    notifyToolsUpdated();
    return origRegister(tool);
  };

  mc.unregisterTool = function (name: string) {
    delete TOOLS[name];
    notifyToolsUpdated();
    return origUnregister(name);
  };
}

// ツール呼び出しリクエストを ISOLATED world から受け取る
window.addEventListener("message", async (event) => {
  if (event.data?.source !== "webmcp-bridge-isolated") return;

  if (event.data.type === "call-tool") {
    const { id, name, args } = event.data;
    const tool = TOOLS[name];

    if (!tool) {
      window.postMessage(
        { source: "webmcp-bridge-main", type: "call-error", id, error: `Tool "${name}" not found` },
        "*"
      );
      return;
    }

    try {
      const result = await tool.execute(args);
      window.postMessage(
        { source: "webmcp-bridge-main", type: "call-result", id, result },
        "*"
      );
    } catch (e: any) {
      window.postMessage(
        { source: "webmcp-bridge-main", type: "call-error", id, error: e.message || String(e) },
        "*"
      );
    }
  }
});

// navigator.modelContext をパッチ
if (typeof navigator !== "undefined") {
  if ((navigator as any).modelContext) {
    patchModelContext((navigator as any).modelContext);
  } else {
    // modelContext がまだ存在しない場合、setter で待機
    let _mc: any;
    try {
      Object.defineProperty(navigator, "modelContext", {
        configurable: true,
        enumerable: true,
        get() {
          return _mc;
        },
        set(v) {
          _mc = v;
          if (v) patchModelContext(v);
        },
      });
    } catch {
      // defineProperty が失敗した場合（ブラウザの制約）、polling で対応
      const interval = setInterval(() => {
        if ((navigator as any).modelContext) {
          clearInterval(interval);
          patchModelContext((navigator as any).modelContext);
        }
      }, 100);
      // 30秒後に polling 停止
      setTimeout(() => clearInterval(interval), 30_000);
    }
  }
}
