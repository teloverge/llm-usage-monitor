'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');

function createDashboardServer({ mediaPath, assetPath, getSnapshot, handleMessage }) {
  const routeKey = crypto.randomBytes(24).toString('base64url');
  const routeBase = `/${routeKey}/`;
  let server;
  let origin;

  async function start() {
    if (server) return `${origin}${routeBase}`;
    server = http.createServer((request, response) => {
      route(request, response).catch(() => {
        if (!response.headersSent) send(response, 500, 'Dashboard request failed.', 'text/plain; charset=utf-8');
        else response.end();
      });
    });
    server.on('error', () => {});
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.removeListener('error', reject);
        resolve();
      });
    });
    const address = server.address();
    origin = `http://127.0.0.1:${address.port}`;
    return `${origin}${routeBase}`;
  }

  async function route(request, response) {
    const requestUrl = new URL(request.url, origin || 'http://127.0.0.1');
    if (!requestUrl.pathname.startsWith(routeBase)) return send(response, 404, 'Not found', 'text/plain; charset=utf-8');
    const resource = requestUrl.pathname.slice(routeBase.length);

    if (request.method === 'GET' && resource === '') {
      const nonce = crypto.randomBytes(24).toString('base64url');
      const template = fs.readFileSync(path.join(mediaPath, 'dashboard.html'), 'utf8');
      const html = template
        .replaceAll('{{CSP_SOURCE}}', "'self'")
        .replaceAll('{{NONCE}}', nonce)
        .replaceAll('{{STYLES_URI}}', './styles.css')
        .replaceAll('{{SCRIPT_URI}}', './main.js');
      return send(response, 200, html, 'text/html; charset=utf-8');
    }
    if (request.method === 'GET' && resource === 'Teloverge-lum-logo.svg') {
      return send(response, 200, fs.readFileSync(path.join(assetPath, resource)), 'image/svg+xml');
    }
    if (request.method === 'GET' && (resource === 'styles.css' || resource === 'main.js' || resource === 'pivot.js' || resource === 'timeframe.js')) {
      const contentType = resource.endsWith('.css') ? 'text/css; charset=utf-8' : resource.endsWith('.svg') ? 'image/svg+xml' : 'text/javascript; charset=utf-8';
      return send(response, 200, fs.readFileSync(path.join(mediaPath, resource)), contentType);
    }
    if (request.method === 'GET' && resource === 'api/snapshot') {
      return sendJson(response, 200, getSnapshot());
    }
    if (request.method === 'POST' && resource === 'api/message') {
      if (request.headers.origin !== origin) return sendJson(response, 403, { error: 'Origin denied.' });
      try {
        const message = JSON.parse(await readBody(request));
        if (!message || typeof message.type !== 'string') return sendJson(response, 400, { error: 'Invalid message.' });
        await handleMessage(message);
        return sendJson(response, 200, { ok: true });
      } catch (error) {
        return sendJson(response, error.code === 'BODY_TOO_LARGE' ? 413 : 400, { error: 'Dashboard request failed.' });
      }
    }
    return send(response, 404, 'Not found', 'text/plain; charset=utf-8');
  }

  function dispose() {
    server?.close();
    server = undefined;
    origin = undefined;
  }

  return { start, dispose };
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0;
    let tooLarge = false;
    request.on('data', (chunk) => {
      length += chunk.length;
      if (length > 1_000_000) {
        tooLarge = true;
      } else if (!tooLarge) {
        chunks.push(chunk);
      }
    });
    request.on('end', () => {
      if (tooLarge) {
        const error = new Error('Request body too large.');
        error.code = 'BODY_TOO_LARGE';
        reject(error);
      } else resolve(Buffer.concat(chunks).toString('utf8'));
    });
    request.on('error', reject);
  });
}

function sendJson(response, status, value) {
  send(response, status, JSON.stringify(value), 'application/json; charset=utf-8');
}

function send(response, status, body, contentType) {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': contentType,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer'
  });
  response.end(body);
}

module.exports = { createDashboardServer };
