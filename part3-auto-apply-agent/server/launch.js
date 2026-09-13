import { spawn } from 'node:child_process';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const EXTENSION_DIR = resolve(here, '..', 'extension');

/**
 * Locate a Chrome/Chromium build that supports extensions.
 *
 * `headless_shell` (what Playwright installs by default) does NOT load
 * extensions -- it must be a full Chrome binary running `--headless=new`.
 */
export async function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);

  for (const c of candidates) {
    try { await access(c); return c; } catch { /* keep looking */ }
  }
  // Fall back to whatever Playwright installed, newest first.
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  const { readdir } = await import('node:fs/promises');
  try {
    const dirs = (await readdir(root)).filter((d) => d.startsWith('chromium-')).sort().reverse();
    for (const d of dirs) {
      const p = join(root, d, 'chrome-linux', 'chrome');
      try { await access(p); return p; } catch { /* next */ }
    }
  } catch { /* nothing there */ }
  throw new Error(
    'No Chrome binary found. Set CHROME_PATH to a full Chrome/Chromium build ' +
    '(headless_shell does not support extensions).');
}

/** Point the extension at this run's control plane. */
export async function writeExtensionConfig(controlPlane, pollMs = 1200) {
  await writeFile(join(EXTENSION_DIR, 'config.json'),
    JSON.stringify({ controlPlane, pollMs }, null, 2));
}

export async function launchChrome({ headless = true, profileDir = '.chrome-profile', chromePath } = {}) {
  const bin = chromePath ?? (await findChrome());
  await mkdir(profileDir, { recursive: true });

  const args = [
    // `--headless=new` is the full browser in headless mode; the old headless
    // mode and headless_shell cannot load extensions at all.
    ...(headless ? ['--headless=new'] : []),
    `--user-data-dir=${resolve(profileDir)}`,
    `--load-extension=${EXTENSION_DIR}`,
    `--disable-extensions-except=${EXTENSION_DIR}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-dev-shm-usage',
    '--window-size=1400,1000',
    ...(process.env.NO_SANDBOX === '0' ? [] : ['--no-sandbox']),
    'about:blank',
  ];

  const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const logs = [];
  child.stdout.on('data', (d) => logs.push(String(d)));
  child.stderr.on('data', (d) => logs.push(String(d)));
  return { child, bin, logs, close: () => { try { child.kill('SIGTERM'); } catch { /* gone */ } } };
}
