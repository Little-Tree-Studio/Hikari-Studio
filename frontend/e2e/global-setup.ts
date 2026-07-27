import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

export default async function globalSetup() {
  const root = join(process.cwd(), 'dist');
  const contentTypes: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
  const server = createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://127.0.0.1').pathname);
    const relative = normalize(pathname).replace(/^[/\\]+/, '');
    let file = join(root, relative || 'index.html');
    try { if (statSync(file).isDirectory()) file = join(file, 'index.html'); }
    catch { file = join(root, 'index.html'); }
    response.setHeader('Content-Type', contentTypes[extname(file)] ?? 'application/octet-stream');
    createReadStream(file).on('error', () => { response.statusCode = 404; response.end('Not found'); }).pipe(response);
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(4188, '127.0.0.1', resolve); });
  return async () => new Promise<void>((resolve) => server.close(() => resolve()));
}
