#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { ControlPlane } from './control-plane.js';
import { launchChrome, writeExtensionConfig } from './launch.js';

const HELP = `
Jobnova auto-apply agent

  Fills an ATS job application from a structured profile, using a Chrome
  extension driving the page from the inside. Runs headless on a server.

Usage
  npm run apply -- --url <application URL> [options]

Options
  --url <url>          Job posting or application URL (required)
  --profile <path>     Applicant profile JSON  [profiles/example-profile.json]
  --submit             Actually submit. Without this the agent fills the form
                       and stops for review (the safe default).
  --headful            Show the browser window (local debugging)
  --keep-open          Leave the tab open after the run
  --port <n>           Control-plane port [8787]
  --timeout <ms>       Max run time [180000]
  -h, --help

Note
  Do not point --submit at a real company's board for a demo: it sends a real
  application to a real recruiter. Use the local replica instead:
      npm run fixture        # then use the printed URL
`;

const MIME = { '.pdf': 'application/pdf', '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };

async function main() {
  const argv = process.argv.slice(2);
  if (!argv.length || argv.includes('-h') || argv.includes('--help')) {
    process.stdout.write(HELP);
    return;
  }
  const arg = (f, d) => {
    const i = argv.indexOf(f);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
  };
  const url = arg('--url');
  if (!url) {
    process.stderr.write('error: --url is required\n' + HELP);
    process.exitCode = 2;
    return;
  }

  const profilePath = arg('--profile', 'profiles/example-profile.json');
  const profile = JSON.parse(await readFile(profilePath, 'utf8'));
  const resume = await loadResume(profile);
  const port = Number(arg('--port', '8787'));
  const timeout = Number(arg('--timeout', '180000'));

  const cp = new ControlPlane({ log: console });
  const server = await cp.listen(port);
  const controlPlane = `http://127.0.0.1:${port}`;
  await writeExtensionConfig(controlPlane);

  say(`control plane   ${controlPlane}`);
  say(`profile         ${profilePath} (${profile.identity?.fullName ?? 'unnamed'})`);
  say(`resume          ${resume ? resume.filename : 'none — file uploads will be skipped'}`);
  say(`mode            ${argv.includes('--submit') ? 'SUBMIT' : 'fill only (dry run)'}`);

  const chrome = await launchChrome({ headless: !argv.includes('--headful') });
  say(`chrome          ${chrome.bin}`);

  const runId = cp.enqueue({
    url, profile, resume,
    autoSubmit: argv.includes('--submit'),
    keepTabOpen: argv.includes('--keep-open'),
  });
  say(`run             ${runId}\n`);

  let result;
  try {
    result = await cp.waitFor(runId, timeout);
  } catch (err) {
    process.stderr.write(`\n${String(err.message)}\n`);
    const tail = chrome.logs.slice(-8).join('').trim();
    if (tail) process.stderr.write(`chrome output:\n${tail}\n`);
    process.exitCode = 1;
  } finally {
    chrome.close();
    server.close();
  }
  if (result) {
    process.stdout.write(report(result));
    process.exitCode = ['submitted', 'filled_awaiting_review'].includes(result.status) ? 0 : 1;
  }
}

async function loadResume(profile) {
  const path = profile?.resume?.path;
  if (!path) return null;
  try {
    const buf = await readFile(path);
    return {
      base64: buf.toString('base64'),
      filename: profile.resume.filename ?? basename(path),
      mime: MIME[extname(path).toLowerCase()] ?? 'application/octet-stream',
    };
  } catch {
    say(`warning: resume not found at ${path}`);
    return null;
  }
}

const STATUS_LABEL = {
  submitted: '\x1b[32mSUBMITTED\x1b[0m',
  submitted_unconfirmed: '\x1b[33mSUBMITTED (unconfirmed)\x1b[0m',
  filled_awaiting_review: '\x1b[36mFILLED — awaiting your review\x1b[0m',
  needs_human: '\x1b[33mNEEDS HUMAN\x1b[0m',
  error: '\x1b[31mERROR\x1b[0m',
};

function report(run) {
  const out = ['', `Status  ${STATUS_LABEL[run.status] ?? run.status}`];
  if (run.message) out.push(`        ${run.message}`);

  const fill = (run.steps ?? []).find((s) => s.step === 'fill');
  const r = fill?.report;
  if (r) {
    out.push('', `Adapter: ${r.adapter}`, '');
    out.push('Filled fields');
    for (const f of r.filled) {
      out.push(`  ${f.ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ` +
        `${String(f.field).padEnd(34)} ${String(f.value ?? '').slice(0, 40)}  \x1b[90m(${f.via})\x1b[0m`);
    }
    if (r.unanswered?.length) {
      out.push('', 'Unanswered required questions');
      for (const u of r.unanswered) out.push(`  \x1b[33m!\x1b[0m ${u.field}`);
    }
    if (r.skipped?.length) {
      out.push('', `Skipped: ${r.skipped.length} optional field(s) with no profile value`);
    }
  }
  if (run.artifacts?.length) {
    out.push('', 'Screenshots');
    for (const a of run.artifacts) out.push(`  ${a}`);
  }
  out.push('');
  return out.join('\n');
}

const say = (m) => process.stdout.write(`  ${m}\n`);

main().catch((err) => {
  process.stderr.write(`fatal: ${String(err?.stack ?? err)}\n`);
  process.exitCode = 1;
});
