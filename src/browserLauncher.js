'use strict';

const childProcess = require('child_process');
const { pathToFileURL } = require('url');

function openInDefaultBrowser(filePath, options = {}) {
  if (typeof filePath !== 'string' || !filePath) throw new TypeError('A file path or URL is required.');

  const platform = options.platform || process.platform;
  const execFile = options.execFile || childProcess.execFile;
  const target = /^(?:https?|file):\/\//i.test(filePath) ? filePath : pathToFileURL(filePath).href;
  let executable;
  let args;

  if (platform === 'win32') {
    executable = 'rundll32.exe';
    args = ['url.dll,FileProtocolHandler', target];
  } else if (platform === 'darwin') {
    executable = 'open';
    args = [target];
  } else {
    executable = 'xdg-open';
    args = [target];
  }

  return new Promise((resolve, reject) => {
    execFile(executable, args, { windowsHide: true }, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

module.exports = { openInDefaultBrowser };
