/**
 * Background Service Worker
 * Native Messaging Host と content script を中継する。
 */

const NATIVE_HOST_NAME = "com.webmcp.bridge";

let nativePort: chrome.runtime.Port | null = null;

function connectNativeHost(): void {
  if (nativePort) return;

  try {
    nativePort = chrome.runtime.connectNative(NATIVE_HOST_NAME);

    nativePort.onMessage.addListener((msg: any) => {
      // Native Host → content script (ツール呼び出しリクエスト)
      if (msg.type === "call-tool") {
        // アクティブなタブに転送
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          const tabId = tabs[0]?.id;
          if (tabId) {
            chrome.tabs.sendMessage(tabId, {
              ...msg,
              source: "webmcp-bridge-background",
            });
          }
        });
      }
    });

    nativePort.onDisconnect.addListener(() => {
      nativePort = null;
      // 再接続を試みる（3秒後）
      setTimeout(connectNativeHost, 3000);
    });
  } catch {
    nativePort = null;
    setTimeout(connectNativeHost, 3000);
  }
}

// content script → Native Host
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.source !== "webmcp-bridge-main") return;

  // Native Host が未接続なら接続
  if (!nativePort) {
    connectNativeHost();
  }

  if (nativePort) {
    const { source, ...payload } = msg;
    nativePort.postMessage(payload);
  }

  sendResponse({ ok: true });
  return false;
});

// タブが更新されたときにツール一覧をリセット
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    // ページリロード時、ツールは再登録されるので特に何もしない
    // content script が自動的に再注入され、新しいツールが登録される
  }
});

// 起動時に Native Host に接続
connectNativeHost();
