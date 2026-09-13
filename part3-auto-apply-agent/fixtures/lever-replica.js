import http from 'node:http';

/**
 * Offline replica of Lever's two-step application flow.
 *
 * Field names, the posting -> /apply hop, the custom "cards[...]" question
 * shape, the consent checkbox and the confirmation copy all mirror the real
 * form, so the agent exercises the same code paths it will on jobs.lever.co.
 *
 * Using this for demos matters: pointing an auto-submitting agent at a real
 * company's board sends real applications to real recruiters.
 */

const POSTING_ID = 'd9d64766-3d42-4ba9-94d4-f74cdaf20065';
const COMPANY = 'ekimetrics';

const postingPage = (base) => `<!doctype html>
<html><head><meta charset="utf-8"><title>Senior Data Scientist - Ekimetrics</title></head>
<body>
  <div class="posting-header">
    <h2>Senior Data Scientist</h2>
    <div class="posting-categories"><span>Paris</span><span>Full-time</span></div>
  </div>
  <div class="section-wrapper">
    <p>We are looking for a Senior Data Scientist to join our Paris office.</p>
  </div>
  <div class="postings-btn-wrapper">
    <a class="postings-btn template-btn-submit" href="${base}/${COMPANY}/${POSTING_ID}/apply"
       data-qa="show-page-apply">Apply for this job</a>
  </div>
</body></html>`;

const applyPage = (challenge = false) => `<!doctype html>
<html><head><meta charset="utf-8"><title>Apply — Senior Data Scientist</title>
<style>body{font-family:system-ui;max-width:680px;margin:40px auto;padding:0 20px}
label{display:block;margin:16px 0 4px;font-weight:600;font-size:14px}
input,textarea,select{width:100%;padding:8px;font-size:14px}
.application-question{margin:20px 0}fieldset{border:1px solid #ddd;padding:12px}</style>
</head>
<body>
<h2>Apply for Senior Data Scientist</h2>
<form method="POST" action="/submit" id="application-form" class="application-form"
      enctype="multipart/form-data">

  <label for="f-name">Full name<span>✱</span></label>
  <input id="f-name" name="name" type="text" required>

  <label for="f-email">Email<span>✱</span></label>
  <input id="f-email" name="email" type="email" required>

  <label for="f-phone">Phone</label>
  <input id="f-phone" name="phone" type="text">

  <label for="f-org">Current company</label>
  <input id="f-org" name="org" type="text">

  <label for="f-li">LinkedIn URL</label>
  <input id="f-li" name="urls[LinkedIn]" type="text">

  <label for="f-gh">GitHub URL</label>
  <input id="f-gh" name="urls[GitHub]" type="text">

  <label for="f-pf">Portfolio URL</label>
  <input id="f-pf" name="urls[Portfolio]" type="text">

  <label for="f-resume">Resume/CV<span>✱</span></label>
  <input id="f-resume" name="resume" type="file" accept=".pdf,.doc,.docx" required>

  <div class="application-question">
    <label for="f-exp">How many years of professional experience do you have?<span>✱</span></label>
    <input id="f-exp" name="cards[a1b2][field0]" type="text" required>
  </div>

  <div class="application-question">
    <label for="f-notice">What is your notice period?</label>
    <input id="f-notice" name="cards[a1b2][field1]" type="text">
  </div>

  <div class="application-question">
    <fieldset>
      <legend>Are you legally authorized to work in France?</legend>
      <label><input type="radio" name="cards[c3d4][field0]" value="yes"> Yes</label>
      <label><input type="radio" name="cards[c3d4][field0]" value="no"> No</label>
    </fieldset>
  </div>

  <div class="application-question">
    <label for="f-source">How did you hear about this role?</label>
    <select id="f-source" name="cards[e5f6][field0]">
      <option value="">Select...</option>
      <option value="linkedin">LinkedIn</option>
      <option value="referral">Referral</option>
      <option value="website">Company website</option>
    </select>
  </div>

  <label for="f-comments">Additional information</label>
  <textarea id="f-comments" name="comments" rows="4"></textarea>

  <div class="application-question">
    <label><input type="checkbox" name="consent[gdpr]" required>
      I consent to Ekimetrics storing my personal data for this application.</label>
  </div>

  ${challenge ? `<div class="g-recaptcha" data-sitekey="test-site-key"
       style="width:304px;height:78px;border:1px solid #ccc">Verify you are human</div>` : ''}

  <button type="submit" class="template-btn-submit" data-qa="btn-submit">Submit application</button>
</form>

<script>
// Mirror Lever's client-side validation so a half-filled form fails here too.
document.getElementById('application-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target;
  const missing = [...f.querySelectorAll('[required]')].filter((el) =>
    el.type === 'checkbox' ? !el.checked
    : el.type === 'file' ? el.files.length === 0
    : !el.value.trim());
  if (missing.length) {
    document.body.insertAdjacentHTML('afterbegin',
      '<p style="color:#a00">Please complete all required fields.</p>');
    return;
  }
  const data = {};
  new FormData(f).forEach((v, k) => { data[k] = v instanceof File ? v.name : v; });
  fetch('/submit', { method: 'POST', headers: { 'content-type': 'application/json' },
                     body: JSON.stringify(data) })
    .then(() => { document.body.innerHTML =
      '<h2>Thank you for applying</h2><p>Your application has been received.</p>'; });
});
</script>
</body></html>`;

const thanksPage = `<!doctype html><html><body>
<h2>Thank you for applying</h2><p>Your application has been received.</p></body></html>`;

/** Start the replica. Returns { server, port, submissions }. */
export async function startLeverReplica(port = 0, { challenge = false } = {}) {
  const submissions = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const base = `http://127.0.0.1:${server.address().port}`;

    if (req.method === 'POST' && url.pathname === '/submit') {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        try { submissions.push(JSON.parse(raw)); } catch { submissions.push({ raw }); }
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(thanksPage);
      });
      return;
    }
    if (url.pathname.endsWith('/apply')) {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(applyPage(challenge));
    }
    if (url.pathname.includes(COMPANY)) {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(postingPage(base));
    }
    res.writeHead(404, { 'content-type': 'text/html' });
    res.end('<h1>404</h1>');
  });

  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  const actual = server.address().port;
  return {
    server, submissions, port: actual,
    postingUrl: `http://127.0.0.1:${actual}/${COMPANY}/${POSTING_ID}`,
    close: () => new Promise((r) => server.close(r)),
  };
}

// Allow running standalone: `npm run fixture`
if (import.meta.url === `file://${process.argv[1]}`) {
  const f = await startLeverReplica(Number(process.env.PORT ?? 8799));
  process.stdout.write(`Lever replica: ${f.postingUrl}\n`);
}
