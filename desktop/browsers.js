// Finding Chrome or Edge (Edge comes with Windows 10 and 11), showing the control
// panel in an app window, and opening links and folders.
import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Installed Chromium browsers that Playwright can drive, best first: [{ channel, path }]. */
export function findBrowsers({ platform = process.platform, env = process.env, exists = existsSync } = {}) {
  let candidates;
  if (platform === 'win32') {
    const roots = [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean);
    candidates = [
      ...roots.map((root) => ['chrome', path.win32.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe')]),
      ...roots.map((root) => ['msedge', path.win32.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe')]),
    ];
  } else if (platform === 'darwin') {
    const dirs = ['/Applications', path.join(os.homedir(), 'Applications')];
    candidates = [
      ...dirs.map((d) => ['chrome', `${d}/Google Chrome.app/Contents/MacOS/Google Chrome`]),
      ...dirs.map((d) => ['msedge', `${d}/Microsoft Edge.app/Contents/MacOS/Microsoft Edge`]),
    ];
  } else {
    candidates = [
      ['chrome', '/opt/google/chrome/chrome'],
      ['chrome', '/usr/bin/google-chrome'],
      ['msedge', '/opt/microsoft/msedge/msedge'],
      ['msedge', '/usr/bin/microsoft-edge'],
    ];
  }
  const found = [];
  for (const [channel, file] of candidates) {
    if (!found.some((b) => b.channel === channel) && exists(file)) found.push({ channel, path: file });
  }
  return found;
}

export const browserName = (channel) => ({ chrome: 'Google Chrome', msedge: 'Microsoft Edge' })[channel] ?? channel;

/**
 * Show `url` in a window without tabs or address bar (Chrome/Edge "app" mode), using
 * its own profile folder so it never mixes with the person's browsing. Falls back to
 * the default browser. Returns the child process, or null.
 */
export function openAppWindow(url, { profileDir, width = 1280, height = 880 } = {}) {
  const browser = findBrowsers()[0];
  if (!browser) {
    openExternal(url);
    return null;
  }
  const child = spawn(
    browser.path,
    [
      `--app=${url}`,
      `--user-data-dir=${profileDir}`,
      `--window-size=${width},${height}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-sync',
      '--disable-features=Translate',
    ],
    { stdio: 'ignore', detached: process.platform !== 'win32' },
  );
  child.on('error', () => openExternal(url));
  child.unref();
  return child;
}

/** Open a web address in the default browser, or a folder in the file manager. Never goes through a shell. */
export function openExternal(target) {
  const done = () => {};
  if (process.platform === 'win32') {
    if (/^https?:\/\//i.test(target)) execFile('rundll32.exe', ['url.dll,FileProtocolHandler', target], done);
    else execFile('explorer.exe', [target], done);
  } else {
    execFile(process.platform === 'darwin' ? 'open' : 'xdg-open', [target], done);
  }
}
