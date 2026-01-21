#!/usr/bin/env node
/**
 * Simple static file server for browser samples.
 * 
 * Usage:
 *   node samples/html/server.mjs [port]
 * 
 * Serves files from the project root so that:
 *   - /samples/html/*.html  -> HTML samples
 *   - /dist/*.js            -> Compiled library
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(__dirname, '../..');

const PORT = parseInt(process.argv[2] || '3000', 10);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = createServer(async (req, res) => {
  let url = req.url || '/';
  
  // Remove query string
  url = url.split('?')[0];
  
  // Redirect root to samples directory
  if (url === '/') {
    res.writeHead(302, { 'Location': '/samples/html/' });
    res.end();
    return;
  }
  
  // Default to index.html for directory requests
  if (url === '/samples/html/' || url === '/samples/html') {
    url = '/samples/html/index.html';
  }
  if (url === '/benchmarks/html/' || url === '/benchmarks/html') {
    url = '/benchmarks/html/index.html';
  }
  
  // Security: prevent directory traversal
  if (url.includes('..')) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  
  const filePath = join(ROOT, url);
  const ext = extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  
  try {
    const content = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  } catch (err) {
    if (err.code === 'ENOENT') {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end(`Not found: ${url}`);
    } else {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(`Server error: ${err.message}`);
    }
  }
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}/`);
  console.log(`Samples:    http://localhost:${PORT}/samples/html/`);
  console.log(`Benchmarks: http://localhost:${PORT}/benchmarks/html/`);
  console.log('Press Ctrl+C to stop');
});
