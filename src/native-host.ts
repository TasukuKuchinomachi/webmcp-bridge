import { connectToSocket, type BridgeMessage } from "./socket.js";

/**
 * Native Messaging の stdin を data イベントで読み取るクラス。
 * 4byte LE 長さプレフィックス + JSON のメッセージを逐次パースする。
 */
class NativeMessageReader {
  private buffer = Buffer.alloc(0);
  private onMessage: (msg: unknown) => void;
  private onClose: () => void;

  constructor(onMessage: (msg: unknown) => void, onClose: () => void) {
    this.onMessage = onMessage;
    this.onClose = onClose;

    process.stdin.on("data", (chunk: Buffer | string) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      this.buffer = Buffer.concat([this.buffer, buf]);
      this.tryParse();
    });

    process.stdin.on("end", () => {
      this.onClose();
    });

    process.stdin.resume();
  }

  private tryParse(): void {
    while (true) {
      // ヘッダー（4バイト）が揃うまで待つ
      if (this.buffer.length < 4) return;

      const len = this.buffer.readUInt32LE(0);

      // ボディが揃うまで待つ
      if (this.buffer.length < 4 + len) return;

      const body = this.buffer.subarray(4, 4 + len);
      this.buffer = this.buffer.subarray(4 + len);

      try {
        this.onMessage(JSON.parse(body.toString()));
      } catch {
        // ignore parse errors
      }
    }
  }
}

/**
 * Native Messaging プロトコルで stdout にメッセージを書く。
 */
function writeNativeMessage(msg: unknown): void {
  const json = JSON.stringify(msg);
  const buf = Buffer.from(json);
  const header = Buffer.alloc(4);
  header.writeUInt32LE(buf.length, 0);
  process.stdout.write(header);
  process.stdout.write(buf);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function connectWithRetry(
  onMessage: (msg: BridgeMessage) => void
): Promise<{ send: (msg: BridgeMessage) => void } | null> {
  for (let i = 0; i < 30; i++) {
    try {
      return await connectToSocket((msg) => onMessage(msg));
    } catch {
      await sleep(1000);
    }
  }
  return null;
}

/**
 * Native Messaging Host として起動する。
 */
export async function startNativeHost(): Promise<void> {
  const messageBuffer: BridgeMessage[] = [];
  let socketSend: ((msg: BridgeMessage) => void) | null = null;

  // Chrome からのメッセージ読み取り
  new NativeMessageReader(
    (msg) => {
      const bridgeMsg = msg as BridgeMessage;
      if (socketSend) {
        socketSend(bridgeMsg);
      } else {
        messageBuffer.push(bridgeMsg);
      }
    },
    () => {
      process.exit(0);
    }
  );

  // バックグラウンドで socket 接続
  const conn = await connectWithRetry((msg) => {
    writeNativeMessage(msg);
  });

  if (conn) {
    socketSend = conn.send;
    for (const msg of messageBuffer) {
      socketSend(msg);
    }
    messageBuffer.length = 0;
  }
}
