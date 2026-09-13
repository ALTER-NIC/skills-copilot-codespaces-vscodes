import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { resolveJobsList } from '../src/agent.js';
import { Fetcher } from '../src/http/fetcher.js';
import { loadConfig } from '../src/config.js';
import { createLogger } from '../src/logger.js';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const MAX_BATCH = Number(process.env.MAX_BATCH ?? 10);

const cfg = loadConfig();
const log = createLogger((process.env.LOG_LEVEL as 'info') ?? 'info');
// One shared Fetcher: the disk cache and the browser instance are reused across
// requests, which is what keeps repeat lookups fast on a small deployment.
const fetcher = new Fetcher(cfg, log);

const app = express();
app.use(express.json({ limit: '64kb' }));
app.use(express.static(join(here, 'public'), { maxAge: '1h' }));

/** Crude per-IP token bucket: this endpoint does real crawling, so cap abuse. */
const buckets = new Map<string, { tokens: number; ts: number }>();
const RATE = { capacity: 30, refillPerSec: 0.5 };

function takeToken(ip: string): boolean {
  const now = Date.now() / 1000;
  const b = buckets.get(ip) ?? { tokens: RATE.capacity, ts: now };
  b.tokens = Math.min(RATE.capacity, b.tokens + (now - b.ts) * RATE.refillPerSec);
  b.ts = now;
  if (b.tokens < 1) { buckets.set(ip, b); return false; }
  b.tokens -= 1;
  buckets.set(ip, b);
  return true;
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    browserRendering: cfg.useBrowser,
    linkedinProviders: {
      scrapingdog: Boolean(cfg.scrapingdogApiKey),
      proxycurl: Boolean(cfg.proxycurlApiKey),
      apify: Boolean(cfg.apifyToken),
    },
  });
});

/** Resolve a single LinkedIn URL. The UI fans out so results stream in one by one. */
app.post('/api/resolve', async (req, res) => {
  const ip = req.ip ?? 'unknown';
  if (!takeToken(ip)) {
    res.status(429).json({ error: 'Rate limit exceeded. Please slow down.' });
    return;
  }
  const url = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
  if (!url || !/^https?:\/\//i.test(url)) {
    res.status(400).json({ error: 'Provide a valid http(s) URL.' });
    return;
  }
  try {
    const result = await resolveJobsList(url, { fetcher, logger: log, config: cfg });
    res.json(result);
  } catch (err) {
    log.error('resolve failed', { url, err: String(err) });
    res.status(500).json({ error: 'Resolution failed.', detail: String(err) });
  }
});

/** Batch endpoint for scripted testing. */
app.post('/api/resolve-batch', async (req, res) => {
  const ip = req.ip ?? 'unknown';
  const urls: string[] = Array.isArray(req.body?.urls) ? req.body.urls.slice(0, MAX_BATCH) : [];
  if (!urls.length) {
    res.status(400).json({ error: `Provide "urls": string[] (max ${MAX_BATCH}).` });
    return;
  }
  if (!takeToken(ip)) {
    res.status(429).json({ error: 'Rate limit exceeded.' });
    return;
  }
  const results = [];
  for (const url of urls) {
    results.push(await resolveJobsList(url, { fetcher, logger: log, config: cfg }));
  }
  const ok = results.filter((r) => r.jobsListUrl && r.confidence >= 0.7).length;
  res.json({ total: results.length, resolved: ok, successRate: ok / results.length, results });
});

const server = app.listen(PORT, () => {
  log.info(`job-source agent listening on http://localhost:${PORT}`);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    server.close(() => { void fetcher.close().then(() => process.exit(0)); });
  });
}
