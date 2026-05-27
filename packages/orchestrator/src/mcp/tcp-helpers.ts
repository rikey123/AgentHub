import * as net from "node:net";

export const MAX_MCP_MESSAGE_SIZE = 64 * 1024 * 1024;

export function writeTcpMessage(socket: net.Socket, data: unknown): void {
  const body = Buffer.from(JSON.stringify(data), "utf-8");
  const frame = Buffer.allocUnsafe(4 + body.length);
  frame.writeUInt32BE(body.length, 0);
  body.copy(frame, 4);
  socket.write(frame);
}

export function createTcpMessageReader(
  onMessage: (msg: unknown) => void,
  options: { maxBodyBytes?: number; onError?: (err: Error) => void } = {}
): (chunk: Buffer) => void {
  const maxBodyBytes = options.maxBodyBytes ?? MAX_MCP_MESSAGE_SIZE;
  const onError = options.onError;
  const chunks: Buffer[] = [];
  let total = 0;
  let aborted = false;

  return (chunk: Buffer) => {
    if (aborted) return;
    chunks.push(chunk);
    total += chunk.length;

    while (total >= 4) {
      const bodyLen = peekUInt32BE(chunks);
      if (bodyLen > maxBodyBytes) {
        aborted = true;
        chunks.length = 0;
        total = 0;
        onError?.(new Error(`TCP message length ${bodyLen} exceeds max ${maxBodyBytes}`));
        return;
      }
      const frameLen = 4 + bodyLen;
      if (total < frameLen) break;
      const frame = takeBytes(chunks, frameLen);
      total -= frameLen;
      const jsonStr = frame.subarray(4).toString("utf-8");
      try { onMessage(JSON.parse(jsonStr)); } catch { /* skip malformed */ }
    }
  };
}

function peekUInt32BE(chunks: Buffer[]): number {
  const first = chunks[0];
  if (first && first.length >= 4) return first.readUInt32BE(0);
  const header = Buffer.allocUnsafe(4);
  let filled = 0;
  for (const c of chunks) {
    const copy = Math.min(c.length, 4 - filled);
    c.copy(header, filled, 0, copy);
    filled += copy;
    if (filled >= 4) break;
  }
  return header.readUInt32BE(0);
}

function takeBytes(chunks: Buffer[], n: number): Buffer {
  const out = Buffer.allocUnsafe(n);
  let filled = 0;
  while (filled < n && chunks.length > 0) {
    const c = chunks[0]!;
    const need = n - filled;
    if (c.length <= need) {
      c.copy(out, filled);
      filled += c.length;
      chunks.shift();
    } else {
      c.copy(out, filled, 0, need);
      chunks[0] = c.subarray(need);
      filled += need;
    }
  }
  return out;
}
