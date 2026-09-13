import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ControlPlane } from '../server/control-plane.js';
import { launchChrome, writeExtensionConfig } from '../server/launch.js';
import { startLeverReplica } from '../fixtures/lever-replica.js';
import { startGreenhouseReplica } from '../fixtures/greenhouse-replica.js';

/**
 * Full-stack test: real headless Chrome, real MV3 extension, real form.
 *
 * Asserts on the payload the form actually POSTed, not on the agent's own
 * self-report -- an agent that claims success while submitting an empty form
 * is the failure mode that matters.
 */
const TIMEOUT = 120_000;

async function runAgainstReplica({ autoSubmit, challenge = false }) {
  const replica = await startLeverReplica(0, { challenge });
  const port = 9000 + Math.floor(Math.random() * 900);
  const cp = new ControlPlane({ log: { error() {} } });
  const server = await cp.listen(port);
  await writeExtensionConfig(`http://127.0.0.1:${port}`, 800);

  const profile = JSON.parse(await readFile('profiles/example-profile.json', 'utf8'));
  const buf = await readFile('profiles/resume.pdf');
  const chrome = await launchChrome({ headless: true });

  try {
    const runId = cp.enqueue({
      url: replica.postingUrl,
      profile,
      resume: {
        base64: buf.toString('base64'),
        filename: profile.resume.filename,
        mime: 'application/pdf',
      },
      autoSubmit,
    });
    const result = await cp.waitFor(runId, TIMEOUT - 10_000);
    return { result, submissions: replica.submissions, run: cp.runs.get(runId) };
  } finally {
    chrome.close();
    server.close();
    await replica.close();
  }
}

test('fills and submits a Lever-shaped application end to end', { timeout: TIMEOUT }, async () => {
  const { result, submissions, run } = await runAgainstReplica({ autoSubmit: true });

  assert.equal(result.status, 'submitted', `expected submitted, got ${result.status}: ${result.message}`);
  assert.equal(submissions.length, 1, 'the form should have POSTed exactly once');

  const s = submissions[0];
  // Identity and links, mapped by the Lever adapter's stable name attributes.
  assert.equal(s.name, 'Nicolas Webb Lopez');
  assert.equal(s.email, 'nicolas@example.com');
  assert.equal(s.org, 'Independent');
  assert.equal(s['urls[LinkedIn]'], 'https://www.linkedin.com/in/example');
  assert.equal(s['urls[GitHub]'], 'https://github.com/example');

  // The resume really was attached as a file, not just a filename string.
  assert.equal(s.resume, 'Nicolas_Webb_Lopez_Resume.pdf');

  // Posting-specific custom questions, matched by their label text alone.
  assert.equal(s['cards[a1b2][field0]'], '5', 'years of experience');
  assert.equal(s['cards[a1b2][field1]'], '1 month', 'notice period');
  assert.equal(s['cards[c3d4][field0]'], 'yes', 'work authorization radio');
  assert.equal(s['cards[e5f6][field0]'], 'linkedin', 'source select');

  // Required consent must actually be ticked -- the form rejects it otherwise.
  assert.equal(s['consent[gdpr]'], 'on', 'GDPR consent checkbox');

  assert.ok(run.artifacts.length >= 3, 'should capture before/after/submit screenshots');
});

test('dry run fills the form but does not submit', { timeout: TIMEOUT }, async () => {
  const { result, submissions } = await runAgainstReplica({ autoSubmit: false });
  assert.equal(result.status, 'filled_awaiting_review');
  assert.equal(submissions.length, 0, 'nothing should be submitted without --submit');
});

test('stops and hands off when a human-verification challenge is present',
  { timeout: TIMEOUT }, async () => {
    const { result, submissions, run } = await runAgainstReplica({
      autoSubmit: true, challenge: true,
    });

    // The agent must refuse to proceed, not attempt to work around the check.
    assert.equal(result.status, 'needs_human',
      `expected a handoff, got ${result.status}: ${result.message}`);
    assert.match(result.message, /verification/i);
    assert.equal(submissions.length, 0, 'nothing may be submitted past a challenge');
    assert.ok(run.artifacts.some((a) => a.includes('verification')),
      'should capture a screenshot of the challenge for the human picking it up');
  });

test('generic adapter fills a Greenhouse-shaped form it has no mapping for',
  { timeout: TIMEOUT }, async () => {
    const replica = await startGreenhouseReplica(0);
    const port = 9000 + Math.floor(Math.random() * 900);
    const cp = new ControlPlane({ log: { error() {} } });
    const server = await cp.listen(port);
    await writeExtensionConfig(`http://127.0.0.1:${port}`, 800);

    const profile = JSON.parse(await readFile('profiles/example-profile.json', 'utf8'));
    const buf = await readFile('profiles/resume.pdf');
    const chrome = await launchChrome({ headless: true });

    try {
      const runId = cp.enqueue({
        url: replica.applyUrl, profile, autoSubmit: true,
        resume: { base64: buf.toString('base64'), filename: 'cv.pdf', mime: 'application/pdf' },
      });
      const result = await cp.waitFor(runId, TIMEOUT - 10_000);
      assert.equal(result.status, 'submitted', `got ${result.status}: ${result.message}`);

      const s = replica.submissions[0];
      assert.ok(s, 'form should have submitted');
      // Split name fields, inferred purely from "First Name" / "Last Name" labels.
      assert.equal(s['job_application[first_name]'], 'Nicolas');
      assert.equal(s['job_application[last_name]'], 'Webb Lopez');
      assert.equal(s['job_application[email]'], 'nicolas@example.com');
      assert.equal(s['job_application[resume]'], 'cv.pdf');
      // Yes/No questions resolved from the structured workAuthorization block.
      assert.equal(s['job_application[answers][0]'], 'Yes', 'authorized to work');
      assert.equal(s['job_application[answers][1]'], 'No', 'requires sponsorship');
      assert.equal(s['job_application[answers][2]'], 'https://www.linkedin.com/in/example');
    } finally {
      chrome.close();
      server.close();
      await replica.close();
    }
  });
