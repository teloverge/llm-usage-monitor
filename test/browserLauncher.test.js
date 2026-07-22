'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openInDefaultBrowser } = require('../src/browserLauncher');

test('opens a report with the Windows default file-protocol handler', async () => {
  const calls = [];
  const execFile = (executable, args, options, callback) => {
    calls.push({ executable, args, options });
    callback(null);
  };

  await openInDefaultBrowser('C:\\Reports & Usage\\report #1.html', { platform: 'win32', execFile });

  assert.deepEqual(calls, [{
    executable: 'rundll32.exe',
    args: ['url.dll,FileProtocolHandler', 'file:///C:/Reports%20&%20Usage/report%20%231.html'],
    options: { windowsHide: true }
  }]);
});

test('surfaces browser launch failures', async () => {
  const failure = new Error('launch failed');
  const execFile = (_executable, _args, _options, callback) => callback(failure);

  await assert.rejects(
    openInDefaultBrowser('C:\\Reports\\report.html', { platform: 'win32', execFile }),
    failure
  );
});

test('passes an HTTP dashboard URL directly to the default browser', async () => {
  const calls = [];
  const execFile = (executable, args, options, callback) => {
    calls.push({ executable, args, options });
    callback(null);
  };

  await openInDefaultBrowser('http://127.0.0.1:43123/session/', { platform: 'win32', execFile });

  assert.equal(calls[0].args[1], 'http://127.0.0.1:43123/session/');
});
