import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { NextResponse } from 'next/server';

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.glb': 'model/gltf-binary',
  '.stl': 'model/stl',
  '.gcode': 'text/plain; charset=utf-8',
};

function safePath(baseDir: string, parts: string[]) {
  if (!parts.length || parts.some((part) => part === '..' || part.includes('/') || part.includes('\\'))) {
    return null;
  }
  const abs = path.resolve(process.cwd(), 'public', baseDir, ...parts);
  const root = path.resolve(process.cwd(), 'public', baseDir);
  return abs === root || abs.startsWith(`${root}${path.sep}`) ? abs : null;
}

export async function serveRuntimePublicFile(baseDir: 'uploads' | 'generated', parts: string[], method: string) {
  const abs = safePath(baseDir, parts);
  if (!abs) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const ext = path.extname(abs).toLowerCase();
  const contentType = MIME_BY_EXT[ext];
  if (!contentType) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const info = await stat(abs).catch(() => null);
  if (!info?.isFile()) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const headers = new Headers({
    'Content-Type': contentType,
    'Content-Length': String(info.size),
    'Cache-Control': 'no-store',
  });
  if (method === 'HEAD') return new Response(null, { status: 200, headers });

  const stream = Readable.toWeb(createReadStream(abs)) as ReadableStream;
  return new Response(stream, { status: 200, headers });
}
