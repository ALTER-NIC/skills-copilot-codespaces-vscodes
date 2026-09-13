import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { AgentConfig } from '../config.js';
import type { FetchedDoc, Logger } from '../types.js';

/**
 * HTTP layer for the crawler.
 *
 * Responsibilities kept here so the resolver stays pure logic:
 *  - corporate/agent proxy support (undici ProxyAgent when HTTPS_PROXY is set)
 *  - bounded retries with exponential backoff on transient failures
 *  - a disk cache, so a 20-URL benchmark can be re-run deterministically and fast
 *  - optional headless-browser rendering for JS-only career pages
 */
/**
 * The surface the pipeline depends on. Declaring it as an interface (rather than
 * depending on the concrete class) is what lets the whole agent run against
 * in-memory fixtures in tests, with no network.
 */
export interface HttpClient {
  getText(url: string, init?: RequestInit): Promise<FetchedDoc>;
  getJson<T>(url: string, init?: RequestInit): Promise<T | null>;
  render(url: string): Promise<FetchedDoc>;
  close(): Promise<void>;
}

export class Fetcher implements HttpClient {
  private readonly cfg: AgentConfig;
  private readonly log: Logger;
  private dispatcher: unknown | undefined;
  private browser: BrowserRenderer | null = null;
  /** Hosts that returned a hard block; skip re-hitting them in the same run. */
  private readonly blocked = new Set<string>();

  constructor(cfg: AgentConfig, log: Logger) {
    this.cfg = cfg;
    this.log = log;
  }

  /** Lazily build an undici ProxyAgent so we work behind corporate/agent proxies. */
  private async getDispatcher(): Promise<unknown | undefined> {
    if (this.dispatcher !== undefined) return this.dispatcher;
    const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy;
    if (!proxy) {
      this.dispatcher = undefined;
      return undefined;
    }
    try {
      const { ProxyAgent } = await import('undici');
      this.dispatcher = new ProxyAgent(proxy);
      this.log.debug('using proxy dispatcher', { proxy });
    } catch {
      this.dispatcher = undefined;
    }
    return this.dispatcher;
  }

  async getText(url: string, init: RequestInit = {}): Promise<FetchedDoc> {
    const cached = await this.readCache(url);
    if (cached) return cached;

    const host = safeHost(url);
    if (host && this.blocked.has(host)) {
      return { url, finalUrl: url, status: 0, html: '', contentType: '', rendered: false };
    }

    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.cfg.retries; attempt++) {
      try {
        const doc = await this.once(url, init);
        // 403/429 usually means anti-bot; a retry will not help, but a render might.
        if (doc.status === 403 || doc.status === 429) {
          if (host) this.blocked.add(host);
          this.log.debug('blocked by origin', { url, status: doc.status });
          return doc;
        }
        if (doc.status >= 500 && attempt < this.cfg.retries) {
          await sleep(backoff(attempt));
          continue;
        }
        await this.writeCache(url, doc);
        return doc;
      } catch (err) {
        lastErr = err;
        if (attempt < this.cfg.retries) await sleep(backoff(attempt));
      }
    }
    this.log.debug('fetch failed', { url, err: String(lastErr) });
    return { url, finalUrl: url, status: 0, html: '', contentType: '', rendered: false };
  }

  private async once(url: string, init: RequestInit): Promise<FetchedDoc> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.cfg.timeoutMs);
    try {
      const dispatcher = await this.getDispatcher();
      const res = await fetch(url, {
        ...init,
        signal: ctl.signal,
        redirect: 'follow',
        headers: {
          'user-agent': this.cfg.userAgent,
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'accept-language': 'en-US,en;q=0.9',
          ...(init.headers as Record<string, string> | undefined),
        },
        // undici accepts `dispatcher`; the DOM RequestInit type does not model it.
        ...(dispatcher ? ({ dispatcher } as Record<string, unknown>) : {}),
      } as RequestInit);

      const contentType = res.headers.get('content-type') ?? '';
      // Never buffer multi-MB binaries while hunting for links.
      const html = isTextual(contentType) ? await readCapped(res, 4_000_000) : '';
      return { url, finalUrl: res.url || url, status: res.status, html, contentType, rendered: false };
    } finally {
      clearTimeout(timer);
    }
  }

  async getJson<T>(url: string, init: RequestInit = {}): Promise<T | null> {
    const doc = await this.getText(url, {
      ...init,
      headers: { accept: 'application/json', ...(init.headers as Record<string, string>) },
    });
    if (doc.status < 200 || doc.status >= 300 || !doc.html) return null;
    try {
      return JSON.parse(doc.html) as T;
    } catch {
      return null;
    }
  }

  /**
   * Render with a real browser. Used only when plain HTTP returns a JS shell
   * (common for Workday, Ashby embeds and React career pages).
   */
  async render(url: string): Promise<FetchedDoc> {
    if (!this.cfg.useBrowser) return this.getText(url);
    const cached = await this.readCache(url, 'render');
    if (cached) return cached;
    try {
      this.browser ??= await BrowserRenderer.launch(this.cfg);
      const doc = await this.browser.render(url, this.cfg.timeoutMs);
      await this.writeCache(url, doc, 'render');
      return doc;
    } catch (err) {
      this.log.debug('render failed, falling back to http', { url, err: String(err) });
      return this.getText(url);
    }
  }

  async close(): Promise<void> {
    await this.browser?.close();
    this.browser = null;
  }

  // ---- disk cache -------------------------------------------------------

  private cachePath(url: string, kind = 'http'): string | null {
    if (!this.cfg.cacheDir) return null;
    const h = createHash('sha1').update(kind + '|' + url).digest('hex');
    return join(this.cfg.cacheDir, kind, h.slice(0, 2), `${h}.json`);
  }

  private async readCache(url: string, kind = 'http'): Promise<FetchedDoc | null> {
    const p = this.cachePath(url, kind);
    if (!p) return null;
    try {
      const raw = JSON.parse(await readFile(p, 'utf8')) as { at: number; doc: FetchedDoc };
      if (Date.now() - raw.at > this.cfg.cacheTtlMs) return null;
      return raw.doc;
    } catch {
      return null;
    }
  }

  private async writeCache(url: string, doc: FetchedDoc, kind = 'http'): Promise<void> {
    const p = this.cachePath(url, kind);
    if (!p || !doc.html) return;
    try {
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, JSON.stringify({ at: Date.now(), doc }));
    } catch {
      /* cache is best-effort */
    }
  }
}

/** Thin wrapper over Playwright, imported lazily so it stays an optional dependency. */
class BrowserRenderer {
  private constructor(private readonly browser: any) {}

  static async launch(cfg: AgentConfig): Promise<BrowserRenderer> {
    const { chromium } = (await import('playwright')) as any;
    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    void cfg;
    return new BrowserRenderer(browser);
  }

  async render(url: string, timeoutMs: number): Promise<FetchedDoc> {
    const ctx = await this.browser.newContext({ ignoreHTTPSErrors: true });
    const page = await ctx.newPage();
    try {
      const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
      // Career pages hydrate their job list after load; give the XHRs a moment.
      await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});
      return {
        url,
        finalUrl: page.url(),
        status: res?.status() ?? 0,
        html: await page.content(),
        contentType: 'text/html',
        rendered: true,
      };
    } finally {
      await ctx.close().catch(() => {});
    }
  }

  async close(): Promise<void> {
    await this.browser.close().catch(() => {});
  }
}

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return res.text();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  await reader.cancel().catch(() => {});
  return new TextDecoder('utf-8').decode(concat(chunks, total));
}

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    if (off + c.byteLength > total) { out.set(c.subarray(0, total - off), off); break; }
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

const isTextual = (ct: string): boolean =>
  ct === '' || /text\/|json|xml|javascript/i.test(ct);

const backoff = (attempt: number): number => Math.min(300 * 2 ** attempt, 4000);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function safeHost(url: string): string | null {
  try { return new URL(url).host; } catch { return null; }
}
