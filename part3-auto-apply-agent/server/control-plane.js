import http from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Control plane for the auto-apply agent.
 *
 * Deliberately thin: it owns the queue and the audit trail, nothing else. All
 * browser automation lives in the extension, so this process never needs to
 * speak CDP, and the same queue can be backed by SQS/Redis on EC2 without
 * touching the agent.
 */
export class ControlPlane {
  constructor({ artifactDir = 'run-artifacts', log = console } = {}) {
    this.queue = [];
    this.runs = new Map();
    this.logs = [];
    this.artifactDir = artifactDir;
    this.log = log;
    this.waiters = new Map();
  }

  enqueue(job) {
    const id = job.id ?? `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    const entry = { ...job, id, enqueuedAt: Date.now() };
    this.queue.push(entry);
    this.runs.set(id, { id, status: 'queued', url: job.url, artifacts: [] });
    return id;
  }

  /** Resolve when a run reaches a terminal state. */
  waitFor(runId, timeoutMs = 180_000) {
    return new Promise((resolve, reject) => {
      const existing = this.runs.get(runId);
      if (existing && existing.finishedAt) return resolve(existing);
      const timer = setTimeout(() => {
        this.waiters.delete(runId);
        reject(new Error(`run ${runId} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.waiters.set(runId, { resolve, timer });
    });
  }

  async handleArtifact({ runId, label, dataUrl }) {
    const run = this.runs.get(runId);
    const m = /^data:image\/png;base64,(.+)$/.exec(dataUrl ?? '');
    if (!m) return null;
    await mkdir(join(this.artifactDir, runId), { recursive: true });
    const file = join(this.artifactDir, runId, `${Date.now()}-${label}.png`);
    await writeFile(file, Buffer.from(m[1], 'base64'));
    if (run) run.artifacts.push(file);
    return file;
  }

  completeRun(result) {
    const run = this.runs.get(result.runId) ?? { id: result.runId, artifacts: [] };
    Object.assign(run, result);
    this.runs.set(result.runId, run);
    const waiter = this.waiters.get(result.runId);
    if (waiter) {
      clearTimeout(waiter.timer);
      this.waiters.delete(result.runId);
      waiter.resolve(run);
    }
    return run;
  }

  listen(port) {
    const server = http.createServer((req, res) => this.#route(req, res));
    return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
  }

  async #route(req, res) {
    const send = (code, body) => {
      res.writeHead(code, {
        'content-type': 'application/json',
        // The extension's service worker is an opaque origin; allow its calls.
        'access-control-allow-origin': '*',
        'access-control-allow-headers': 'content-type',
      });
      res.end(JSON.stringify(body ?? {}));
    };
    if (req.method === 'OPTIONS') return send(204, {});

    const url = new URL(req.url, 'http://127.0.0.1');
    try {
      if (req.method === 'GET' && url.pathname === '/api/next-job') {
        const job = this.queue.shift();
        if (job) {
          const run = this.runs.get(job.id);
          if (run) run.status = 'running';
        }
        return send(200, job ?? {});
      }
      if (req.method === 'GET' && url.pathname === '/api/runs') {
        return send(200, { runs: [...this.runs.values()] });
      }
      if (req.method === 'GET' && url.pathname.startsWith('/api/runs/')) {
        const id = url.pathname.split('/').pop();
        const run = this.runs.get(id);
        return run ? send(200, run) : send(404, { error: 'unknown run' });
      }

      if (req.method === 'POST') {
        const body = await readJson(req);
        if (url.pathname === '/api/jobs') return send(200, { id: this.enqueue(body) });
        if (url.pathname === '/api/result') return send(200, this.completeRun(body));
        if (url.pathname === '/api/artifact') {
          return send(200, { saved: await this.handleArtifact(body) });
        }
        if (url.pathname === '/api/log') {
          this.logs.push(body);
          if (body.level === 'error') this.log.error?.(`[ext] ${body.msg}`, body.meta ?? '');
          return send(200, {});
        }
      }
      send(404, { error: 'not found' });
    } catch (err) {
      send(500, { error: String(err) });
    }
  }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 12_000_000) reject(new Error('payload too large'));
    });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}
