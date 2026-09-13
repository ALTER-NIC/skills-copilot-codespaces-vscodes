#!/usr/bin/env node
import { resolveJobsList } from '../src/agent.js';
import { createLogger } from '../src/logger.js';
import type { JobsListResult } from '../src/types.js';

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', cyan: '\x1b[36m', grey: '\x1b[90m',
};

const HELP = `
${C.bold}Jobnova job-source agent${C.reset}

  LinkedIn job posting URL  ->  that company's job listing page.

${C.bold}Usage${C.reset}
  npm run resolve -- <url> [options]

${C.bold}Options${C.reset}
  --json          Emit the full result as JSON on stdout (pipe-friendly)
  --verbose       Debug logging to stderr
  --browser       Enable headless-browser rendering for JS-only career pages
  --no-cache      Bypass the on-disk page cache
  -h, --help      Show this help

${C.bold}Examples${C.reset}
  npm run resolve -- https://www.linkedin.com/jobs/view/4427787182/
  npm run resolve -- https://jobs.lever.co/ekimetrics --json
`;

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (!argv.length || argv.includes('-h') || argv.includes('--help')) {
    process.stdout.write(HELP);
    return;
  }
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const url = argv.find((a) => !a.startsWith('-'));
  if (!url) {
    process.stderr.write(`${C.red}error:${C.reset} no URL given\n${HELP}`);
    process.exitCode = 2;
    return;
  }

  const result = await resolveJobsList(url, {
    logger: createLogger(flags.has('--verbose') ? 'debug' : 'warn'),
    config: {
      useBrowser: flags.has('--browser'),
      ...(flags.has('--no-cache') ? { cacheDir: null } : {}),
    },
  });

  if (flags.has('--json')) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    process.stdout.write(render(result));
  }
  process.exitCode = result.jobsListUrl ? 0 : 1;
}

/** Human-readable report: the answer, then how we got there. */
export function render(r: JobsListResult): string {
  const lines: string[] = [];
  const ok = Boolean(r.jobsListUrl) && r.confidence >= 0.7;

  lines.push('');
  lines.push(`${C.bold}Input${C.reset}   ${C.dim}${r.input}${C.reset}`);
  lines.push(`${C.bold}Company${C.reset} ${r.company.name ?? C.dim + 'unknown' + C.reset}` +
    (r.company.website ? `  ${C.dim}${r.company.website}${C.reset}` : ''));
  lines.push('');

  lines.push(`${C.bold}Decision trace${C.reset}`);
  for (const step of r.trace) {
    const badge = `${C.cyan}${step.stage.padEnd(20)}${C.reset}`;
    lines.push(`  ${badge} ${step.outcome}${step.ms ? C.grey + ` (${step.ms}ms)` + C.reset : ''}`);
    if (step.detail) lines.push(`  ${' '.repeat(20)} ${C.dim}${step.detail}${C.reset}`);
    if (step.url) lines.push(`  ${' '.repeat(20)} ${C.grey}${step.url}${C.reset}`);
    for (const c of (step.candidates ?? []).slice(0, 4)) {
      lines.push(`  ${' '.repeat(22)} ${C.grey}${String(c.score).padStart(5)}  ${c.url}  ` +
        `[${c.reasons.slice(0, 3).join(' ')}]${C.reset}`);
    }
  }
  lines.push('');

  if (ok) {
    lines.push(`${C.green}${C.bold}JOBS LIST${C.reset}  ${C.bold}${r.jobsListUrl}${C.reset}`);
  } else if (r.jobsListUrl) {
    lines.push(`${C.yellow}${C.bold}LOW CONFIDENCE${C.reset}  ${r.jobsListUrl}`);
  } else {
    lines.push(`${C.red}${C.bold}NOT FOUND${C.reset}`);
  }

  const meta = [
    r.ats ? `ats=${r.ats}/${r.atsSlug}` : `kind=${r.kind}`,
    r.jobCount === null ? null : `open_roles=${r.jobCount}`,
    `confidence=${r.confidence.toFixed(2)}`,
    `${r.totalMs}ms`,
  ].filter(Boolean).join('  ');
  lines.push(`${C.dim}${meta}${C.reset}`);

  for (const e of r.errors) lines.push(`${C.red}!${C.reset} ${e}`);
  lines.push('');
  return lines.join('\n');
}

main().catch((err) => {
  process.stderr.write(`${C.red}fatal:${C.reset} ${String(err)}\n`);
  process.exitCode = 1;
});
