export class BodyTooLargeError extends Error {}

/** Do not trust Content-Length: enforce the same limit while consuming chunked requests. */
export async function readBoundedBody(req: Request, maxBytes: number): Promise<Buffer> {
  const declared = Number(req.headers.get('content-length'));
  if (declared > maxBytes) throw new BodyTooLargeError();
  if (!req.body) return Buffer.alloc(0);
  const reader = req.body.getReader();
  const chunks: Buffer[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new BodyTooLargeError(); }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, size);
  } finally { reader.releaseLock(); }
}
