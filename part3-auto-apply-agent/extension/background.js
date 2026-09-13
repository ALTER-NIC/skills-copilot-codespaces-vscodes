/**
 * Jobnova auto-apply — orchestrator (MV3 service worker).
 *
 * Runs entirely inside Chrome. It pulls work from a local control plane, drives
 * the tab through the application flow, and posts results back. Nothing attaches
 * a remote automation driver to the browser: the extension *is* the agent.
 *
 * Why an extension instead of driving the page from outside:
 *   - Multi-step ATS flows (Workday is 5+ pages) survive navigation here, where
 *     an external script has to re-attach and re-find state on every hop.
 *   - It reacts to DOM mutations natively instead of polling selectors.
 *   - It uses a persistent Chrome profile, so sessions that require an account
 *     (Workday) stay logged in across runs.
 *   - The same code runs headless on the server and headful on a person's
 *     machine, which is what makes the human-handoff path below practical.
 */

const DEFAULTS = { controlPlane: 'http://127.0.0.1:8787', pollMs: 1500 };
let CONFIG = { ...DEFAULTS };
let running = false;

async function loadConfig() {
  try {
    const res = await fetch(chrome.runtime.getURL('config.json'));
    CONFIG = { ...DEFAULTS, ...(await res.json()) };
  } catch {
    CONFIG = { ...DEFAULTS };
  }
}

const api = (path) => `${CONFIG.controlPlane}${path}`;

const log = async (level, msg, meta) => {
  console[level === 'error' ? 'error' : 'log'](`[agent] ${msg}`, meta ?? '');
  try {
    await fetch(api('/api/log'), {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ level, msg, meta, at: Date.now() }),
    });
  } catch { /* control plane down; console still has it */ }
};

// ---------------------------------------------------------------- tab helpers

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Resolve once the tab finishes loading (or the timeout expires). */
function waitForLoad(tabId, timeoutMs = 30000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(timer);
      resolve(ok);
    };
    const listener = (id, info) => {
      if (id === tabId && info.status === 'complete') finish(true);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then((t) => { if (t.status === 'complete') finish(true); })
      .catch(() => finish(false));
  });
}

async function inject(tabId) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
}

/** Send a message to the content script, retrying while it boots. */
async function ask(tabId, message, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await chrome.tabs.sendMessage(tabId, message);
      if (res) return res;
    } catch (err) {
      if (i === attempts - 1) return { ok: false, error: String(err) };
      await inject(tabId).catch(() => {});
      await sleep(400 * (i + 1));
    }
  }
  return { ok: false, error: 'no response from content script' };
}

async function screenshot(tabId, label, runId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    await fetch(api('/api/artifact'), {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ runId, label, dataUrl }),
    });
    return true;
  } catch (err) {
    await log('warn', 'screenshot failed', { label, err: String(err) });
    return false;
  }
}

// ------------------------------------------------------------------- the run

/**
 * Drive one application end to end.
 *
 * Stops and reports `needs_human` the moment a verification challenge appears.
 * That is a deliberate boundary, not a missing feature: see README "Human
 * verification" for why, and for the supported alternative (ATS partner APIs).
 */
async function runJob(job) {
  const runId = job.id;
  const steps = [];
  const record = (step, data) => {
    steps.push({ step, at: Date.now(), ...data });
    return data;
  };

  let tab;
  try {
    tab = await chrome.tabs.create({ url: job.url, active: true });
    await waitForLoad(tab.id);
    await inject(tab.id);
    record('open', { url: job.url });

    // A Lever posting page links to its own /apply page; follow it.
    const found = await ask(tab.id, { type: 'FIND_APPLY_LINK' });
    if (!found.hasForm && found.href) {
      await chrome.tabs.update(tab.id, { url: found.href });
      await waitForLoad(tab.id);
      await inject(tab.id);
      record('navigate-to-apply', { url: found.href });
    }
    await sleep(500);
    await screenshot(tab.id, 'before-fill', runId);

    const filled = await ask(tab.id, {
      type: 'FILL', profile: job.profile, resume: job.resume,
    });
    record('fill', filled);

    if (filled.status === 'needs_human') {
      await screenshot(tab.id, 'verification', runId);
      return finish(runId, 'needs_human', steps,
        'Human verification appeared before the form could be filled.', tab.id, job);
    }
    if (!filled.ok) {
      await screenshot(tab.id, 'fill-failed', runId);
      return finish(runId, 'error', steps, filled.error || 'fill failed', tab.id, job);
    }

    await screenshot(tab.id, 'after-fill', runId);

    const unanswered = (filled.report?.unanswered ?? []).filter((u) => u.required);
    if (unanswered.length) {
      return finish(runId, 'needs_human', steps,
        `Required questions have no answer in the profile: ${
          unanswered.map((u) => u.field).join('; ')}`, tab.id, job);
    }

    if (!job.autoSubmit) {
      return finish(runId, 'filled_awaiting_review', steps,
        'Form filled. autoSubmit is off, so the application was not submitted.', tab.id, job);
    }

    const submitted = await ask(tab.id, { type: 'SUBMIT' });
    record('submit', submitted);
    await sleep(1200);
    await screenshot(tab.id, 'after-submit', runId);

    if (submitted.status === 'needs_human') {
      return finish(runId, 'needs_human', steps,
        'Human verification appeared at the submit step.', tab.id, job);
    }
    if (submitted.status === 'submitted' && submitted.success?.ok) {
      return finish(runId, 'submitted', steps,
        `Confirmed: "${submitted.success.phrase}"`, tab.id, job);
    }
    return finish(runId, submitted.ok ? 'submitted_unconfirmed' : 'error', steps,
      submitted.ok ? 'Submit clicked but no confirmation text was found.'
                   : (submitted.error || submitted.status), tab.id, job);
  } catch (err) {
    await log('error', 'run threw', { runId, err: String(err) });
    return finish(runId, 'error', steps, String(err), tab?.id, job);
  }
}

async function finish(runId, status, steps, message, tabId, job) {
  const result = { runId, status, message, steps, finishedAt: Date.now() };
  await fetch(api('/api/result'), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(result),
  }).catch(() => {});
  await log('info', `run ${runId} -> ${status}`, { message });

  // Keep the tab open when a person needs to finish the application by hand.
  const handoff = status === 'needs_human';
  if (tabId != null && !handoff && !job?.keepTabOpen) {
    await chrome.tabs.remove(tabId).catch(() => {});
  }
  return result;
}

// -------------------------------------------------------------- work loop

async function pollOnce() {
  if (running) return;
  try {
    const res = await fetch(api('/api/next-job'));
    if (!res.ok) return;
    const job = await res.json();
    if (!job || !job.id) return;
    running = true;
    await log('info', `picked up job ${job.id}`, { url: job.url });
    await runJob(job);
  } catch {
    /* control plane not up yet */
  } finally {
    running = false;
  }
}

/**
 * MV3 workers are evicted when idle, so the fast loop is backed by an alarm that
 * revives the worker. Between them the queue is drained promptly and reliably.
 */
async function loop() {
  await pollOnce();
  setTimeout(loop, CONFIG.pollMs);
}

async function boot() {
  await loadConfig();
  await log('info', 'agent ready', { controlPlane: CONFIG.controlPlane });
  chrome.alarms.create('watchdog', { periodInMinutes: 0.5 });
  loop();
}

chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'watchdog') pollOnce(); });
chrome.runtime.onStartup.addListener(boot);
chrome.runtime.onInstalled.addListener(boot);
boot();
