/**
 * ISOLATED world content script
 * MAIN world ⇔ Extension background の橋渡し。
 */

// MAIN world → Extension background
window.addEventListener("message", (event) => {
  if (event.data?.source !== "webmcp-bridge-main") return;

  chrome.runtime.sendMessage(event.data).catch(() => {});
});

// Extension background → MAIN world
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.source === "webmcp-bridge-background") {
    window.postMessage({ ...msg, source: "webmcp-bridge-isolated" }, "*");
  }
});
