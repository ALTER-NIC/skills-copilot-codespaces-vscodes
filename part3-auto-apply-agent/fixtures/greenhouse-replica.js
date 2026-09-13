import http from 'node:http';

/**
 * Greenhouse-shaped application form.
 *
 * Deliberately shares nothing with the Lever replica: different field names,
 * split first/last name, no adapter entry. If the agent fills this, it is the
 * generic label-inference path doing the work, not a hardcoded mapping.
 */
const page = `<!doctype html>
<html><head><meta charset="utf-8"><title>Apply — Infra Engineer</title>
<style>body{font-family:system-ui;max-width:680px;margin:40px auto;padding:0 20px}
label{display:block;margin:14px 0 4px;font-weight:600}input,textarea,select{width:100%;padding:8px}</style>
</head><body>
<h1>Infrastructure Engineer</h1>
<form id="application_form" method="POST" action="/submit">
  <label for="first_name">First Name *</label>
  <input id="first_name" name="job_application[first_name]" type="text" required>

  <label for="last_name">Last Name *</label>
  <input id="last_name" name="job_application[last_name]" type="text" required>

  <label for="email">Email *</label>
  <input id="email" name="job_application[email]" type="email" required>

  <label for="phone">Phone</label>
  <input id="phone" name="job_application[phone]" type="text">

  <label for="resume">Resume *</label>
  <input id="resume" name="job_application[resume]" type="file" required>

  <label for="q1">Are you legally authorized to work in the United States? *</label>
  <select id="q1" name="job_application[answers][0]" required>
    <option value="">--</option><option value="Yes">Yes</option><option value="No">No</option>
  </select>

  <label for="q2">Will you now or in the future require sponsorship? *</label>
  <select id="q2" name="job_application[answers][1]" required>
    <option value="">--</option><option value="Yes">Yes</option><option value="No">No</option>
  </select>

  <label for="q3">LinkedIn Profile</label>
  <input id="q3" name="job_application[answers][2]" type="text">

  <label for="q4">Why do you want to work here?</label>
  <textarea id="q4" name="job_application[answers][3]"></textarea>

  <button type="submit" id="submit_app">Submit Application</button>
</form>
<script>
document.getElementById('application_form').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target;
  const missing = [...f.querySelectorAll('[required]')].filter((el) =>
    el.type === 'file' ? el.files.length === 0 : !el.value.trim());
  if (missing.length) {
    document.body.insertAdjacentHTML('afterbegin', '<p id="err">Missing required fields.</p>');
    return;
  }
  const data = {};
  new FormData(f).forEach((v, k) => { data[k] = v instanceof File ? v.name : v; });
  fetch('/submit', { method: 'POST', headers: { 'content-type': 'application/json' },
                     body: JSON.stringify(data) })
    .then(() => { document.body.innerHTML = '<h2>Application submitted</h2>'; });
});
</script>
</body></html>`;

export async function startGreenhouseReplica(port = 0) {
  const submissions = [];
  const server = http.createServer((req, res) => {
    if (req.method === 'POST') {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        try { submissions.push(JSON.parse(raw)); } catch { /* ignore */ }
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<h2>Application submitted</h2>');
      });
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(page);
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  const actual = server.address().port;
  return {
    server, submissions, port: actual,
    applyUrl: `http://127.0.0.1:${actual}/jobs/123`,
    close: () => new Promise((r) => server.close(r)),
  };
}
