import { readdirSync, readFileSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { extname } from 'node:path';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; frame-src 'self' blob: data:; connect-src 'self'; img-src 'self' data:",
};

interface Asset {
  readonly body: Buffer;
  readonly contentType: string;
}

export class StaticAssets {
  readonly #assets: ReadonlyMap<string, Asset>;

  constructor(directory: URL) {
    const files = readdirSync(directory).filter((file) => extname(file) in CONTENT_TYPES);
    if (!files.includes('index.html')) {
      throw new Error('The web app is not built yet. Run "npm run build:web" first.');
    }
    this.#assets = new Map(
      files.map((file) => [
        file === 'index.html' ? '/' : `/${file}`,
        {
          body: readFileSync(new URL(file, directory)),
          contentType: CONTENT_TYPES[extname(file)] ?? 'application/octet-stream',
        },
      ]),
    );
  }

  serve(path: string, response: ServerResponse): boolean {
    const asset = this.#assets.get(path);
    if (!asset) return false;
    response.writeHead(200, {
      'Content-Type': asset.contentType,
      'Cache-Control': 'no-cache',
      ...SECURITY_HEADERS,
    });
    response.end(asset.body);
    return true;
  }
}
