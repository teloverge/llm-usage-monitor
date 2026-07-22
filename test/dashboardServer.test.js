'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createDashboardServer } = require('../src/dashboardServer');

test('serves the dashboard and accepts same-origin actions on a private route', async () => {
  const messages = [];
  const server = createDashboardServer({
    mediaPath: path.join(__dirname, '..', 'media'),
    assetPath: path.join(__dirname, '..', 'assets'),
    getSnapshot: () => ({ type: 'snapshot', snapshot: { records: [], prices: [] } }),
    handleMessage: async (message) => messages.push(message)
  });
  const url = await server.start();
  const origin = new URL(url).origin;

  try {
    const pageResponse = await fetch(url);
    const page = await pageResponse.text();
    assert.equal(pageResponse.status, 200);
    assert.match(page, /connect-src 'self'/);
    assert.match(page, /img-src 'self'/);
    assert.match(page, /src="\.\/Teloverge-lum-logo\.svg"/);
    assert.match(page, /src="\.\/pivot\.js"/);
    assert.match(page, /src="\.\/timeframe\.js"/);
    assert.match(page, /src="\.\/main\.js"/);
    assert.match(page, /id="pivotChart"/);
    assert.doesNotMatch(page, /\{\{NONCE\}\}/);

    const pivotResponse = await fetch(new URL('pivot.js', url));
    assert.equal(pivotResponse.status, 200);
    assert.match(pivotResponse.headers.get('content-type'), /text\/javascript/);

    const timeframeResponse = await fetch(new URL('timeframe.js', url));
    assert.equal(timeframeResponse.status, 200);

    const logoResponse = await fetch(new URL('Teloverge-lum-logo.svg', url));
    assert.equal(logoResponse.status, 200);
    assert.match(logoResponse.headers.get('content-type'), /image\/svg\+xml/);

    const snapshotResponse = await fetch(new URL('api/snapshot', url));
    assert.deepEqual(await snapshotResponse.json(), { type: 'snapshot', snapshot: { records: [], prices: [] } });

    const actionResponse = await fetch(new URL('api/message', url), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ type: 'importCodex' })
    });
    assert.equal(actionResponse.status, 200);
    assert.deepEqual(messages, [{ type: 'importCodex' }]);

    const deniedResponse = await fetch(new URL('api/message', url), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://example.com' },
      body: JSON.stringify({ type: 'clearData' })
    });
    assert.equal(deniedResponse.status, 403);
  } finally {
    server.dispose();
  }
});
