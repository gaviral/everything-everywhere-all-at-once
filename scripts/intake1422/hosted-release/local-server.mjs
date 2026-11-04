import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

export async function servePreview(directory) {
  const root = resolve(directory);
  const sockets = new Set();
  const server = createServer(async (request, response) => {
    try {
      const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const file = resolve(root, `.${path === '/' ? '/preview.html' : path}`);
      if (!file.startsWith(`${root}${sep}`)) { response.writeHead(403).end(); return; }
      const bytes = await readFile(file);
      response.writeHead(200, { 'content-type': mime[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' }).end(bytes);
    } catch { response.writeHead(404).end(); }
  });
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { url: `http://127.0.0.1:${server.address().port}/`, close: () => new Promise(resolve => {
    server.close(resolve);
    for (const socket of sockets) socket.destroy();
  }) };
}
