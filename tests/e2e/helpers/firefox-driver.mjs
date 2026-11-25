import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const EXT_ID = 'webpullbook@wiltongabriel.github.io';

function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

export function resolveFirefoxExecutablePath() {
  const envBin = process.env.FIREFOX_BIN;
  if (envBin && fs.existsSync(envBin)) return envBin;
  try {
    const found = execFileSync('which', ['firefox'], { encoding: 'utf8', stdio: 'pipe' }).trim();
    if (found && fs.existsSync(found)) return found;
  } catch {
    // fallback to known install paths
  }
  for (const candidate of ['/usr/bin/firefox', '/usr/local/bin/firefox']) {
    if (fs.existsSync(candidate)) return candidate;
  }
  const cacheDir = path.join(os.homedir(), '.cache', 'ms-playwright');
  if (fs.existsSync(cacheDir)) {
    const dirs = fs
      .readdirSync(cacheDir)
      .filter((d) => /^firefox-\d+$/.test(d))
      .sort((a, b) => Number(b.slice('firefox-'.length)) - Number(a.slice('firefox-'.length)));
    for (const d of dirs) {
      const bin = path.join(cacheDir, d, 'firefox', 'firefox');
      if (fs.existsSync(bin)) return bin;
    }
  }
  return null;
}

class MarionetteClient {
  constructor(sock) {
    this.sock = sock;
    this.buf = Buffer.alloc(0);
    this.waiters = [];
    this.nextId = 1;
    sock.on('data', (chunk) => {
      const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      this.buf = Buffer.concat([this.buf, incoming]);
      while (true) {
        const colonIdx = this.buf.indexOf(0x3a); // ':'
        if (colonIdx < 0) break;
        const len = parseInt(this.buf.subarray(0, colonIdx).toString('ascii'), 10);
        if (Number.isNaN(len) || this.buf.length < colonIdx + 1 + len) break;
        const jsonStr = this.buf.subarray(colonIdx + 1, colonIdx + 1 + len).toString('utf8');
        this.buf = this.buf.subarray(colonIdx + 1 + len);
        const w = this.waiters.shift();
        if (w) w.resolve(JSON.parse(jsonStr));
      }
    });
    sock.on('error', (err) => {
      while (this.waiters.length) this.waiters.shift().reject(err);
    });
    sock.on('close', () => {
      while (this.waiters.length) this.waiters.shift().reject(new Error('Marionette connection closed'));
    });
  }

  _nextPacket(timeoutMs = 60000) {
    return new Promise((resolve, reject) => {
      let waiter;
      const timer = setTimeout(() => {
        const idx = this.waiters.indexOf(waiter);
        if (idx >= 0) this.waiters.splice(idx, 1);
        reject(new Error(`Marionette packet timeout after ${timeoutMs}ms`));
      }, timeoutMs);
      waiter = {
        resolve: (val) => {
          clearTimeout(timer);
          resolve(val);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        }
      };
      this.waiters.push(waiter);
    });
  }

  async command(name, params = {}) {
    const id = this.nextId++;
    const payload = JSON.stringify([0, id, name, params]);
    this.sock.write(`${Buffer.byteLength(payload)}:${payload}`);
    const pkt = await this._nextPacket();
    const err = pkt[2];
    if (err) {
      const e = new Error(`${err.error || 'marionette error'}: ${err.message || JSON.stringify(err)}`);
      e.marionetteError = err;
      throw e;
    }
    return pkt[3];
  }

  close() {
    this.sock.end();
  }
}

export async function launchFirefoxExtension({ repoRoot = path.resolve('.'), headless = true } = {}) {
  const firefoxBin = resolveFirefoxExecutablePath();
  if (!firefoxBin) {
    throw new Error('Firefox binary not found. Install Firefox or set FIREFOX_BIN.');
  }

  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wpb-ff-e2e-'));
  const downloadDir = path.join(profileDir, 'downloads');
  fs.mkdirSync(downloadDir, { recursive: true });
  const mPort = await findFreePort();

  fs.writeFileSync(
    path.join(profileDir, 'user.js'),
    [
      `user_pref("marionette.port", ${mPort});`,
      'user_pref("browser.shell.checkDefaultBrowser", false);',
      'user_pref("toolkit.telemetry.reportingpolicy.firstRun", false);',
      'user_pref("datareporting.policy.dataSubmissionEnabled", false);',
      'user_pref("browser.startup.homepage_override.mstone", "ignore");',
      'user_pref("browser.tabs.warnOnClose", false);',
      'user_pref("browser.download.folderList", 2);',
      `user_pref("browser.download.dir", ${JSON.stringify(downloadDir)});`,
      'user_pref("browser.download.useDownloadDir", true);',
      'user_pref("browser.download.alwaysOpenPanel", false);',
      'user_pref("browser.helperApps.neverAsk.saveToDisk", "application/epub+zip,application/json,text/html,text/markdown,text/plain");'
    ].join('\n')
  );

  const proc = spawn(
    firefoxBin,
    [...(headless ? ['--headless'] : []), '--new-instance', '--profile', profileDir, '--marionette', 'about:blank'],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: '1' }
    }
  );

  let stderrTail = '';
  proc.stderr.on('data', (d) => {
    stderrTail = (stderrTail + d.toString()).slice(-2000);
  });

  let sock = null;
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      sock = await new Promise((resolve, reject) => {
        const s = net.connect(mPort, '127.0.0.1');
        const timer = setTimeout(() => {
          s.destroy();
          reject(new Error('Marionette connect timeout'));
        }, 1000);
        s.on('connect', () => {
          clearTimeout(timer);
          resolve(s);
        });
        s.on('error', (err) => {
          clearTimeout(timer);
          reject(err);
        });
      });
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  if (!sock) {
    proc.kill('SIGTERM');
    fs.rmSync(profileDir, { recursive: true, force: true });
    throw new Error(`Failed to connect to Firefox Marionette on port ${mPort}.\n${stderrTail}`);
  }

  const client = new MarionetteClient(sock);
  await client._nextPacket(); // handshake hello
  await client.command('WebDriver:NewSession', { capabilities: {} });
  await client.command('WebDriver:SetTimeouts', { script: 120000, pageLoad: 60000 });
  await client.command('Addon:Install', { path: path.resolve(repoRoot), temporary: true });
  await client.command('Marionette:SetContext', { value: 'chrome' });
  const uuidsRes = await client.command('WebDriver:ExecuteScript', {
    script: 'return Services.prefs.getStringPref("extensions.webextensions.uuids", "{}");'
  });
  const uuids = JSON.parse(uuidsRes?.value || '{}');
  const extUuid = uuids[EXT_ID];
  if (!extUuid) {
    client.close();
    proc.kill('SIGTERM');
    fs.rmSync(profileDir, { recursive: true, force: true });
    throw new Error(`Could not resolve Firefox temporary add-on UUID for ${EXT_ID}`);
  }
  await client.command('Marionette:SetContext', { value: 'content' });
  const workspaceBaseUrl = `moz-extension://${extUuid}/src/workspace/workspace.html`;

  const execAsync = async (fnBody, ...args) => {
    const res = await client.command('WebDriver:ExecuteAsyncScript', {
      script: `const done = arguments[arguments.length - 1];
const inputArgs = JSON.parse(arguments[0]);
Promise.resolve((async (...fnArgs) => {
${fnBody}
})(...inputArgs))
  .then((val) => done({ ok: true, value: val === undefined ? null : val }))
  .catch((err) => done({ ok: false, error: err?.message || String(err), stack: err?.stack || '' }));`,
      args: [JSON.stringify(args)]
    });
    const out = res?.value;
    if (!out?.ok) {
      throw new Error(`Firefox script error: ${out?.error || JSON.stringify(res)}\n${out?.stack || ''}`);
    }
    return out.value;
  };

  return {
    client,
    extUuid,
    workspaceBaseUrl,
    downloadDir,
    profileDir,
    async newTab(url = 'about:blank') {
      const win = await client.command('WebDriver:NewWindow', { type: 'tab' });
      await client.command('WebDriver:SwitchToWindow', { handle: win.handle });
      if (url && url !== 'about:blank') {
        await client.command('WebDriver:Navigate', { url });
      }
      return win.handle;
    },
    async navigate(url) {
      return client.command('WebDriver:Navigate', { url });
    },
    async switchToTab(handle) {
      return client.command('WebDriver:SwitchToWindow', { handle });
    },
    async getTabs() {
      return client.command('WebDriver:GetWindowHandles', {});
    },
    async closeTab(handle) {
      await client.command('WebDriver:SwitchToWindow', { handle });
      return client.command('WebDriver:CloseWindow', {});
    },
    async openWorkspace(initialUrl = '', sourceTabId = null) {
      const target = new URL(workspaceBaseUrl);
      if (initialUrl) target.searchParams.set('url', initialUrl);
      if (sourceTabId != null) target.searchParams.set('sourceTabId', String(sourceTabId));
      const handle = await this.newTab(target.toString());
      await this.waitFor(
        `return Boolean(document.querySelector('#starting-url') && document.querySelector('#opt-parser option'));`,
        15000
      );
      return handle;
    },
    execAsync,
    async waitFor(fnBody, timeoutMs = 20000, intervalMs = 200) {
      const deadline = Date.now() + timeoutMs;
      let lastErr = null;
      while (Date.now() < deadline) {
        try {
          const val = await execAsync(fnBody);
          if (val) return val;
        } catch (e) {
          lastErr = e;
        }
        await new Promise((r) => setTimeout(r, intervalMs));
      }
      throw new Error(
        `Firefox waitFor timeout (${timeoutMs}ms)${lastErr ? ` (${lastErr.message})` : ''}: ${fnBody.slice(0, 120)}`
      );
    },
    async click(selector) {
      return execAsync(
        `const el = document.querySelector(fnArgs[0]);
         if (!el) throw new Error('Missing element: ' + fnArgs[0]);
         el.click();
         return true;`,
        selector
      );
    },
    async fill(selector, value) {
      return execAsync(
        `const el = document.querySelector(fnArgs[0]);
         if (!el) throw new Error('Missing input: ' + fnArgs[0]);
         el.value = fnArgs[1];
         el.dispatchEvent(new Event('input', { bubbles: true }));
         el.dispatchEvent(new Event('change', { bubbles: true }));
         return el.value;`,
        selector,
        value
      );
    },
    async selectOption(selector, value) {
      return execAsync(
        `const el = document.querySelector(fnArgs[0]);
         if (!el) throw new Error('Missing select: ' + fnArgs[0]);
         el.value = fnArgs[1];
         el.dispatchEvent(new Event('change', { bubbles: true }));
         return el.value;`,
        selector,
        value
      );
    },
    async setChecked(selector, checked) {
      return execAsync(
        `const el = document.querySelector(fnArgs[0]);
         if (!el) throw new Error('Missing checkbox: ' + fnArgs[0]);
         if (el.checked !== Boolean(fnArgs[1])) el.click();
         return el.checked;`,
        selector,
        checked
      );
    },
    async waitForDownloadedFile(matcherRx, timeoutMs = 25000) {
      const deadline = Date.now() + timeoutMs;
      const walkFiles = (dir) => {
        if (!fs.existsSync(dir)) return [];
        const out = [];
        for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, ent.name);
          if (ent.isDirectory()) out.push(...walkFiles(full));
          else if (!ent.name.endsWith('.part')) out.push(full);
        }
        return out;
      };
      while (Date.now() < deadline) {
        const files = walkFiles(downloadDir).filter((f) => matcherRx.test(f));
        if (files.length > 0) {
          // Ensure non-empty file size settles
          files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
          if (fs.statSync(files[0]).size > 0) return files[0];
        }
        await new Promise((r) => setTimeout(r, 200));
      }
      throw new Error(`Timed out waiting for downloaded file matching ${matcherRx} in ${downloadDir}`);
    },
    async close({ cleanup = true } = {}) {
      try {
        await client.command('Marionette:Quit', {});
      } catch {
        // ignore if closing
      }
      client.close();
      proc.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 300));
      if (cleanup) {
        fs.rmSync(profileDir, { recursive: true, force: true });
      }
    }
  };
}
