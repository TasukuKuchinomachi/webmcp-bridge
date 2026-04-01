/**
 * Background Service Worker
 * タブ別にツールを管理し、Native Messaging Host と content script を中継する。
 * chrome.storage.session で状態を永続化（SW 再起動に対応）。
 */

const NATIVE_HOST_NAME = "com.webmcp.bridge";
const STORAGE_KEY = "tabTools";

interface TabInfo {
  url: string;
  title: string;
  tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>;
}

let nativePort: chrome.runtime.Port | null = null;

// 更新の直列化キュー
let updateQueue: Promise<void> = Promise.resolve();

function enqueue(fn: () => Promise<void>): void {
  updateQueue = updateQueue.then(fn).catch(() => {});
}

/** chrome.storage.session から tabTools を読み込む */
async function loadTabTools(): Promise<Record<number, TabInfo>> {
  const data = await chrome.storage.session.get(STORAGE_KEY);
  return data[STORAGE_KEY] || {};
}

/** chrome.storage.session に tabTools を保存する */
async function saveTabTools(tabTools: Record<number, TabInfo>): Promise<void> {
  await chrome.storage.session.set({ [STORAGE_KEY]: tabTools });
}

function connectNativeHost(): void {
  if (nativePort) return;

  try {
    nativePort = chrome.runtime.connectNative(NATIVE_HOST_NAME);

    nativePort.onMessage.addListener((msg: any) => {
      if (msg.type === "call-tool") {
        const tabId = msg.tabId;
        if (tabId) {
          chrome.tabs.sendMessage(tabId, {
            ...msg,
            source: "webmcp-bridge-background",
          });
        }
      }
    });

    nativePort.onDisconnect.addListener(() => {
      nativePort = null;
      setTimeout(connectNativeHost, 3000);
    });
  } catch {
    nativePort = null;
    setTimeout(connectNativeHost, 3000);
  }
}

let broadcastTimer: ReturnType<typeof setTimeout> | null = null;

/** broadcastTools を debounce して呼ぶ（React StrictMode 等の中間状態を回避） */
function scheduleBroadcast(): void {
  if (broadcastTimer) clearTimeout(broadcastTimer);
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null;
    broadcastTools();
  }, 1000);
}

/**
 * 全タブのツールをマージし、重複するツール名をタブIDで解決する。
 * 結果を Native Host に送信する。
 */
async function broadcastTools(): Promise<void> {
  const tabTools = await loadTabTools();
  const entries = Object.entries(tabTools);

  // 全ツール名の出現回数を数える
  const nameCount = new Map<string, number>();
  for (const [, info] of entries) {
    for (const tool of info.tools) {
      nameCount.set(tool.name, (nameCount.get(tool.name) || 0) + 1);
    }
  }

  // マージ済みツール一覧を構築
  const mergedTools: Array<{
    name: string;
    originalName: string;
    description: string;
    inputSchema: Record<string, unknown>;
    tabId: number;
  }> = [];

  for (const [tabIdStr, info] of entries) {
    const tabId = Number(tabIdStr);
    for (const tool of info.tools) {
      const resolvedName =
        (nameCount.get(tool.name) || 0) > 1
          ? `${tool.name}_tab_${tabId}`
          : tool.name;

      mergedTools.push({
        name: resolvedName,
        originalName: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        tabId,
      });
    }
  }

  if (!nativePort) connectNativeHost();

  if (nativePort) {
    nativePort.postMessage({ type: "tools-updated", tools: mergedTools });
  }
}

// content script → background
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.source !== "webmcp-bridge-main") return;

  if (msg.type === "tools-updated" && sender.tab?.id != null) {
    const tabId = sender.tab.id;
    const url = sender.tab.url || "";
    const title = sender.tab.title || "";
    enqueue(async () => {
      const tabTools = await loadTabTools();
      tabTools[tabId] = { url, title, tools: msg.tools };
      await saveTabTools(tabTools);
      scheduleBroadcast();
    });
  } else if (msg.type === "call-result" || msg.type === "call-error") {
    if (nativePort) {
      const { source, ...payload } = msg;
      nativePort.postMessage(payload);
    }
  }

  sendResponse({ ok: true });
  return false;
});

// タブが閉じたらツールを削除
chrome.tabs.onRemoved.addListener((tabId) => {
  enqueue(async () => {
    const tabTools = await loadTabTools();
    if (tabTools[tabId]) {
      delete tabTools[tabId];
      await saveTabTools(tabTools);
      scheduleBroadcast();
    }
  });
});

// 起動時に Native Host に接続 + 全タブにツール再報告を要求
connectNativeHost();
chrome.tabs.query({}, (tabs) => {
  for (const tab of tabs) {
    if (tab.id) {
      chrome.tabs.sendMessage(tab.id, {
        source: "webmcp-bridge-background",
        type: "request-tools",
      }).catch(() => {});
    }
  }
});
