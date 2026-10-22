import type { IncomingMessage, ServerResponse } from 'node:http';

import type { z } from 'zod';

export const MAX_BODY_BYTES = 1_048_576;

export class HttpError extends Error {
  override readonly name = 'HttpError';
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(body));
}

const APP_VIEW_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  "frame-ancestors 'self'",
].join('; ');

export function sendAppView(response: ServerResponse, html: string): void {
  response.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': APP_VIEW_CSP,
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(html);
}

export function sendError(response: ServerResponse, status: number, message: string): void {
  sendJson(response, status, { error: message });
}

export async function readJson<T>(request: IncomingMessage, schema: z.ZodType<T>): Promise<T> {
  if (!request.headers['content-type']?.startsWith('application/json')) {
    throw new HttpError(415, 'Expected an application/json body');
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'Request body is too large');
    chunks.push(chunk);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Request body is not valid JSON');
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new HttpError(400, result.error.issues.map((issue) => issue.message).join('; '));
  }
  return result.data;
}

export function openEventStream(response: ServerResponse): (event: unknown) => void {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  return (event) => {
    if (!response.writableEnded) response.write(`data: ${JSON.stringify(event)}\n\n`);
  };
}
