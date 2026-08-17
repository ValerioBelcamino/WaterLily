import { readFile } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve } from 'node:path';

const APP_HOST = 'app';
const APP_PROTOCOL = 'waterlily:';
const STATIC_HEADERS = {
  'cache-control': 'no-store',
  'content-security-policy': [
    "default-src 'self'",
    "base-uri 'none'",
    "connect-src 'self'",
    "font-src 'self' data:",
    "frame-ancestors 'none'",
    "img-src 'self' data: blob:",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "worker-src 'self' blob:",
  ].join('; '),
  'cross-origin-resource-policy': 'same-origin',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
} as const;

const MIME_TYPES: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

export interface DesktopProtocolRouterOptions {
  readonly apiHandler: (request: Request) => Promise<Response>;
  readonly staticDirectory: string;
}

function response(status: number, message: string): Response {
  return new Response(message, {
    headers: {
      ...STATIC_HEADERS,
      'content-type': 'text/plain; charset=utf-8',
    },
    status,
  });
}

function staticPath(root: string, pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;
  const requested = decoded === '/' ? '/index.html' : decoded;
  const candidate = resolve(root, `.${requested}`);
  const childPath = relative(root, candidate);
  if (
    childPath.length === 0 ||
    childPath.startsWith('..') ||
    isAbsolute(childPath)
  )
    return null;
  return candidate;
}

export function createDesktopProtocolRouter(
  options: DesktopProtocolRouterOptions,
): (request: Request) => Promise<Response> {
  const root = resolve(options.staticDirectory);
  return async (request) => {
    const url = new URL(request.url);
    if (url.protocol !== APP_PROTOCOL || url.hostname !== APP_HOST)
      return response(404, 'Not found');
    if (url.pathname === '/api' || url.pathname.startsWith('/api/'))
      return options.apiHandler(request);
    if (request.method !== 'GET' && request.method !== 'HEAD')
      return response(405, 'Method not allowed');

    const path = staticPath(root, url.pathname);
    if (path === null) return response(400, 'Invalid path');
    try {
      const bytes = await readFile(path);
      return new Response(request.method === 'HEAD' ? null : bytes, {
        headers: {
          ...STATIC_HEADERS,
          'content-length': String(bytes.byteLength),
          'content-type':
            MIME_TYPES[extname(path).toLowerCase()] ??
            'application/octet-stream',
        },
      });
    } catch (error: unknown) {
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? error.code
          : undefined;
      if (code === 'ENOENT' || code === 'EISDIR')
        return response(404, 'Not found');
      throw error;
    }
  };
}
