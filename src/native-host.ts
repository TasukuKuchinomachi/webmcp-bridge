import { connectToSocket, type BridgeMessage } from "./socket.js";

/**
 * Native Messaging プロトコルで stdin からメッセージを読む。
 * 形式: 4byte LE 長さプレフィックス + JSON
 */
function readNativeMessage(): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;

    const readLength = () => {
      const header = stdin.read(4);
      if (!header) {
        stdin.once("readable", readLength);
        return;
      }
      const len = header.readUInt32LE(0);
      const readBody = () => {
        const body = stdin.read(len);
        if (!body) {
          stdin.once("readable", readBody);
          return;
        }
        try {
          resolve(JSON.parse(body.toString()));
        } catch (e) {
          reject(e);
        }
      };
      readBody();
    };
    readLength();
  });
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

/**
 * Native Messaging Host として起動する。
 * Chrome 拡張 ↔ Unix socket (MCP サーバー) を中継する。
 */
export async function startNativeHost(): Promise<void> {
  process.stdin.resume();

  // Unix socket に接続（MCP サーバーが listen 中）
  let socketSend: ((msg: BridgeMessage) => void) | null = null;

  try {
    const { send } = await connectToSocket((msg) => {
      // MCP サーバーからのメッセージを Chrome 拡張に転送
      writeNativeMessage(msg);
    });
    socketSend = send;
  } catch {
    // MCP サーバーがまだ起動していない場合、ソケットなしで動作
    // ツール情報はバッファして後で送る
  }

  // Chrome 拡張からのメッセージを読み続ける
  while (true) {
    const msg = (await readNativeMessage()) as BridgeMessage;

    if (socketSend) {
      // Unix socket 経由で MCP サーバーに転送
      socketSend(msg);
    }
  }
}
