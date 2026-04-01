/**
 * MAIN world content script
 * navigator.modelContext.registerTool を monkey-patch して
 * 登録されたツールを window.__webmcp_tools__ に公開する。
 * AI エージェントは javascript 経由でツールを発見・呼び出しできる。
 */

(function () {
  const win = window as any;
  if (!win.__webmcp_tools__) win.__webmcp_tools__ = {};

  function patchModelContext(mc: any): void {
    if (mc.__webmcp_bridge_patched) return;
    mc.__webmcp_bridge_patched = true;

    const origRegister = mc.registerTool.bind(mc);
    const origUnregister = mc.unregisterTool.bind(mc);

    mc.registerTool = function (tool: any) {
      win.__webmcp_tools__[tool.name] = {
        name: tool.name,
        description: tool.description || "",
        inputSchema: tool.inputSchema
          ? JSON.parse(JSON.stringify(tool.inputSchema))
          : {},
        execute: tool.execute,
      };
      return origRegister(tool);
    };

    mc.unregisterTool = function (name: string) {
      delete win.__webmcp_tools__[name];
      return origUnregister(name);
    };
  }

  if ((navigator as any).modelContext) {
    patchModelContext((navigator as any).modelContext);
  } else {
    let _mc: any;
    try {
      Object.defineProperty(navigator, "modelContext", {
        configurable: true,
        enumerable: true,
        get() { return _mc; },
        set(v) { _mc = v; if (v) patchModelContext(v); },
      });
    } catch {
      const interval = setInterval(() => {
        if ((navigator as any).modelContext) {
          clearInterval(interval);
          patchModelContext((navigator as any).modelContext);
        }
      }, 100);
      setTimeout(() => clearInterval(interval), 30_000);
    }
  }
})();
