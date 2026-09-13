#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolveJobsList } from '../src/agent.js';
import { Fetcher } from '../src/http/fetcher.js';
import { loadConfig } from '../src/config.js';
import { createLogger, silentLogger } from '../src/logger.js';
import { FakeHttp } from '../src/testing/fakeHttp.js';
import { CORPUS } from './corpus.js';
import type { JobsListResult } from '../src/types.js';

/** A result counts as a success when we produced a page we are confident in. */
const SUCCESS_THRESHOLD = 0.7;
const isSuccess = (r: JobsListResult): boolean =>
  Boolean(r.jobsListUrl) && r.confidence >= SUCCESS_THRESHOLD;

interface Row {
  input: string;
  company: string;
  jobsListUrl: string;
  kind: string;
  ats: string;
  jobCount: string;
  confidence: number;
  ms: number;
  ok: boolean;
  /** Only set in offline mode, where ground truth is known. */
  expected?: string;
  matchedExpectation?: boolean;
  error: string;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const offline = argv.includes('--offline');
  const outDir = argFor(argv, '--out') ?? 'bench/out';
  await mkdir(outDir, { recursive: true });

  const rows = offline ? await runOffline() : await runLive(argv);

  const total = rows.length;
  const ok = rows.filter((r) => r.ok).length;
  const rate = total ? (ok / total) * 100 : 0;

  printTable(rows);
  const heading = offline ? 'Offline regression corpus' : 'Live LinkedIn benchmark';
  const exact = rows.filter((r) => r.matchedExpectation !== undefined);
  const exactOk = exact.filter((r) => r.matchedExpectation).length;

  process.stdout.write(`\n${'='.repeat(72)}\n`);
  process.stdout.write(`${heading}: ${ok}/${total} resolved  =  ${rate.toFixed(1)}% success rate\n`);
  if (exact.length) {
    process.stdout.write(
      `Exact-URL match vs ground truth: ${exactOk}/${exact.length} ` +
      `(${((exactOk / exact.length) * 100).toFixed(1)}%)\n`);
  }
  process.stdout.write(`${'='.repeat(72)}\n`);

  await writeFile(`${outDir}/results.json`, JSON.stringify({ heading, total, ok, rate, rows }, null, 2));
  await writeFile(`${outDir}/results.csv`, toCsv(rows));
  await writeFile(`${outDir}/report.md`, toMarkdown(heading, rows, rate));
  process.stdout.write(`\nWrote ${outDir}/report.md, results.csv, results.json\n`);

  // Offline mode is a regression gate: any ground-truth miss fails the run.
  if (offline && exactOk !== exact.length) process.exitCode = 1;
}

async function runOffline(): Promise<Row[]> {
  const rows: Row[] = [];
  for (const s of CORPUS) {
    const r = await resolveJobsList(s.input, {
      fetcher: new FakeHttp(s.routes),
      logger: silentLogger,
      config: { cacheDir: null, retries: 0, useBrowser: false },
    });
    const expected = s.expect.jobsListUrl;
    rows.push({
      ...toRow(r),
      input: s.name,
      expected: expected || '(expected: no result)',
      matchedExpectation: (r.jobsListUrl ?? '') === expected,
    });
  }
  return rows;
}

async function runLive(argv: string[]): Promise<Row[]> {
  const file = argFor(argv, '--urls') ?? 'bench/urls.json';
  const urls = await readUrls(file);
  if (!urls.length) {
    process.stderr.write(
      `No URLs found in ${file}.\n` +
      `Create it as a JSON array of LinkedIn job posting URLs, e.g.\n` +
      `  ["https://www.linkedin.com/jobs/view/4427787182/", ...]\n` +
      `See bench/urls.sample.json.\n`);
    process.exit(2);
  }

  const cfg = loadConfig({ useBrowser: !argv.includes('--no-browser') });
  const log = createLogger(argv.includes('--verbose') ? 'debug' : 'warn');
  // One Fetcher across the whole run so the cache and browser are shared.
  const fetcher = new Fetcher(cfg, log);
  const rows: Row[] = [];
  let done = 0;

  try {
    await pool(urls, cfg.concurrency, async (url) => {
      const r = await resolveJobsList(url, { fetcher, logger: log, config: cfg });
      rows.push(toRow(r));
      done++;
      process.stderr.write(`\r  resolved ${done}/${urls.length}   `);
    });
  } finally {
    await fetcher.close();
    process.stderr.write('\n');
  }
  return rows;
}

function toRow(r: JobsListResult): Row {
  return {
    input: r.input,
    company: r.company.name ?? '',
    jobsListUrl: r.jobsListUrl ?? '',
    kind: r.kind,
    ats: r.ats ?? '',
    jobCount: r.jobCount === null ? '' : String(r.jobCount),
    confidence: Number(r.confidence.toFixed(2)),
    ms: r.totalMs,
    ok: isSuccess(r),
    error: r.errors[0] ?? '',
  };
}

// ---- output formats ---------------------------------------------------

function printTable(rows: Row[]): void {
  const w = { n: 3, name: 38, out: 46, conf: 5 };
  process.stdout.write(
    `\n${'#'.padEnd(w.n)} ${'INPUT / SCENARIO'.padEnd(w.name)} ` +
    `${'RESULT'.padEnd(w.out)} ${'CONF'.padEnd(w.conf)} OK\n`);
  process.stdout.write('-'.repeat(w.n + w.name + w.out + w.conf + 8) + '\n');
  rows.forEach((r, i) => {
    const mark = r.matchedExpectation === false ? '\x1b[31mMISS\x1b[0m'
      : r.matchedExpectation === true ? '\x1b[32m ok \x1b[0m'
      : r.ok ? '\x1b[32m ok \x1b[0m' : '\x1b[31mfail\x1b[0m';
    process.stdout.write(
      `${String(i + 1).padEnd(w.n)} ${trunc(r.input, w.name).padEnd(w.name)} ` +
      `${trunc(r.jobsListUrl || r.error || '-', w.out).padEnd(w.out)} ` +
      `${String(r.confidence).padEnd(w.conf)} ${mark}\n`);
  });
}

function toCsv(rows: Row[]): string {
  const cols: Array<keyof Row> = ['input', 'company', 'jobsListUrl', 'kind', 'ats',
    'jobCount', 'confidence', 'ms', 'ok', 'expected', 'matchedExpectation', 'error'];
  const esc = (v: unknown): string => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}

function toMarkdown(heading: string, rows: Row[], rate: number): string {
  const ok = rows.filter((r) => r.ok).length;
  const byAts = new Map<string, number>();
  for (const r of rows.filter((x) => x.ok)) {
    const k = r.ats || (r.kind === 'self-hosted-list' ? 'self-hosted' : r.kind);
    byAts.set(k, (byAts.get(k) ?? 0) + 1);
  }
  const lines = [
    `# ${heading}`,
    '',
    `**Success rate: ${ok}/${rows.length} = ${rate.toFixed(1)}%**`,
    '',
    `A run counts as a success when the agent returns a job listing page with`,
    `confidence >= ${SUCCESS_THRESHOLD}. Confidence is highest when the page is a`,
    `recognised ATS board confirmed through that vendor's public API.`,
    '',
    '## Breakdown by destination',
    '',
    '| Destination | Resolved |',
    '| --- | ---: |',
    ...[...byAts.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `| ${k} | ${v} |`),
    '',
    '## Per-URL results',
    '',
    '| # | Input | Company | Jobs list page | ATS | Open roles | Conf. | OK |',
    '| ---: | --- | --- | --- | --- | ---: | ---: | :-: |',
    ...rows.map((r, i) =>
      `| ${i + 1} | ${mdEsc(trunc(r.input, 60))} | ${mdEsc(r.company)} | ` +
      `${r.jobsListUrl ? `[link](${r.jobsListUrl})` : '—'} | ${r.ats || '—'} | ` +
      `${r.jobCount || '—'} | ${r.confidence} | ${r.ok ? 'YES' : 'NO'} |`),
    '',
  ];
  const failures = rows.filter((r) => !r.ok);
  if (failures.length) {
    lines.push('## Failures', '');
    for (const f of failures) lines.push(`- \`${trunc(f.input, 70)}\` — ${f.error || 'no job listing page found'}`);
    lines.push('');
  }
  return lines.join('\n');
}

// ---- helpers ----------------------------------------------------------

async function readUrls(file: string): Promise<string[]> {
  try {
    const raw = await readFile(file, 'utf8');
    const trimmed = raw.trim();
    const parsed: unknown = trimmed.startsWith('[') ? JSON.parse(trimmed)
      : trimmed.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Bounded-concurrency map; keeps us polite to the sites we crawl. */
async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++]!;
      try { await fn(item); } catch { /* recorded per-row */ }
    }
  });
  await Promise.all(workers);
}

const argFor = (argv: string[], flag: string): string | undefined => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
};
const trunc = (s: string, n: number): string => (s.length <= n ? s : s.slice(0, n - 1) + '…');
const mdEsc = (s: string): string => s.replace(/\|/g, '\\|');

main().catch((err) => {
  process.stderr.write(`bench failed: ${String(err)}\n`);
  process.exitCode = 1;
});
