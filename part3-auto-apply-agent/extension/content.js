/**
 * Jobnova auto-apply — page agent.
 *
 * Injected into the ATS application page. Everything here runs inside the page's
 * own renderer: there is no automation driver attached, so the form is filled by
 * the same code path a browser extension would use on a human's own machine.
 *
 * Self-contained on purpose (no imports, no bundler) so the extension can be
 * loaded straight from disk on a server.
 */
(() => {
  if (window.__jobnovaAgentLoaded) return;
  window.__jobnovaAgentLoaded = true;

  // ---------------------------------------------------------------- utils

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const lower = (s) => norm(s).toLowerCase();
  const slug = (s) => lower(s).replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

  const visible = (el) => {
    if (!el || el.disabled) return false;
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  /**
   * React and Vue track input state internally, so assigning `el.value` is
   * silently discarded on re-render. Going through the prototype's native setter
   * updates the DOM node in a way the framework's own listeners observe.
   */
  function setNativeValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
  }

  /** Fill a text-ish field with the event sequence a real edit produces. */
  async function fillText(el, value) {
    if (!el || value === undefined || value === null || value === '') return false;
    el.focus();
    el.dispatchEvent(new Event('focus', { bubbles: true }));
    setNativeValue(el, String(value));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
    await sleep(30);
    return el.value === String(value);
  }

  /** Choose the option whose text or value best matches `want`. */
  async function selectOption(el, want) {
    if (!el || !want) return false;
    const target = lower(want);
    const opts = [...el.options];
    let hit = opts.find((o) => lower(o.textContent) === target || lower(o.value) === target)
      || opts.find((o) => lower(o.textContent).includes(target) || target.includes(lower(o.textContent)))
      || (/^(yes|true)$/i.test(want) ? opts.find((o) => /^yes$/i.test(norm(o.textContent))) : null)
      || (/^(no|false)$/i.test(want) ? opts.find((o) => /^no$/i.test(norm(o.textContent))) : null);
    if (!hit) return false;
    el.focus();
    el.value = hit.value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(30);
    return true;
  }

  /** Tick the radio/checkbox in a group whose label best matches `want`. */
  async function chooseOption(inputs, want) {
    if (!inputs.length || !want) return false;
    const target = lower(want);
    const scored = inputs.map((i) => ({ i, t: lower(labelTextFor(i) || i.value) }));
    const hit = scored.find((s) => s.t === target)
      || scored.find((s) => s.t.includes(target) || target.includes(s.t));
    if (!hit) return false;
    hit.i.focus();
    hit.i.checked = true;
    hit.i.dispatchEvent(new Event('input', { bubbles: true }));
    hit.i.dispatchEvent(new Event('change', { bubbles: true }));
    hit.i.dispatchEvent(new Event('click', { bubbles: true }));
    await sleep(30);
    return true;
  }

  /**
   * Attach a file to a native <input type=file>. The bytes arrive from the
   * control plane as base64; a DataTransfer is the supported way to populate
   * `input.files` programmatically.
   */
  async function attachFile(input, file) {
    if (!input || !file || !file.base64) return false;
    try {
      const bin = atob(file.base64);
      const buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      const f = new File([buf], file.filename || 'resume.pdf',
        { type: file.mime || 'application/pdf' });
      const dt = new DataTransfer();
      dt.items.add(f);
      input.files = dt.files;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(150);
      return input.files.length === 1;
    } catch (e) {
      return false;
    }
  }

  /** Best-effort question text for an arbitrary form control. */
  function labelTextFor(el) {
    if (el.id) {
      const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (l) return norm(l.textContent);
    }
    const wrapping = el.closest('label');
    if (wrapping) return norm(wrapping.textContent);
    const aria = el.getAttribute('aria-label');
    if (aria) return norm(aria);
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const t = labelledBy.split(/\s+/).map((id) => document.getElementById(id))
        .filter(Boolean).map((n) => norm(n.textContent)).join(' ');
      if (t) return t;
    }
    // ATS markup usually wraps each question in an "application-question" block.
    const block = el.closest(
      '.application-question, .application-field, [class*="question"], [class*="field"], li, fieldset, div');
    if (block) {
      const heading = block.querySelector('label, legend, .application-label, [class*="label"]');
      if (heading && !heading.contains(el)) return norm(heading.textContent);
    }
    return norm(el.placeholder || el.name || '');
  }

  // ------------------------------------------------------- profile mapping

  const yn = (b) => (b ? 'Yes' : 'No');

  /**
   * Map a question's text to a value from the profile.
   *
   * Ordered most-specific first: "current company" must beat the bare "company"
   * rule, and "first name" must beat "name".
   */
  function valueForLabel(label, profile) {
    const t = lower(label);
    const id = profile.identity || {};
    const links = profile.links || {};
    const auth = profile.workAuthorization || {};
    const eeo = profile.eeo || {};
    const answers = profile.answers || {};

    const RULES = [
      [/first name|given name|forename/, id.firstName],
      [/last name|family name|surname/, id.lastName],
      [/full name|^name$|your name|legal name/, id.fullName],
      [/e-?mail/, id.email],
      [/phone|mobile|telephone|contact number/, id.phone],
      [/linked-?in/, links.linkedin],
      [/git-?hub/, links.github],
      [/twitter|x profile/, links.twitter],
      [/portfolio|personal (web)?site|website|blog/, links.portfolio],
      [/other (url|link|website)/, links.other],
      [/current (company|employer)|present employer/, id.currentCompany],
      [/current (title|role|position)|job title/, id.currentTitle],
      [/company|employer|organization|organisation/, id.currentCompany],
      [/location|city|where are you (based|located)|country of residence/,
        auth.countryOfResidence || id.location],
      [/cover letter|why (do|are) you|motivation/, profile.coverLetter],
      [/additional information|anything else|comments|notes/, profile.coverLetter],
      [/years? of (professional )?experience/, answers.years_of_experience],
      [/notice period|when can you start|availability|start date/, answers.notice_period],
      [/salary|compensation|rate expectation/, answers.salary_expectation],
      [/how did you hear|referr?al|referred by|source/, answers.referral],
      [/sponsorship|visa|work permit/, yn(auth.requiresSponsorship)],
      [/authoriz|authoris|eligible to work|right to work/, yn(auth.authorizedToWork)],
      [/gender/, eeo.gender],
      [/race|ethnic/, eeo.race],
      [/veteran/, eeo.veteranStatus],
      [/disab/, eeo.disabilityStatus],
    ];

    for (const [re, val] of RULES) {
      if (re.test(t) && val !== undefined && val !== null && val !== '') return String(val);
    }
    // Fall back to an explicit answer keyed by the slugified question.
    const key = slug(label);
    if (answers[key]) return String(answers[key]);
    for (const [k, v] of Object.entries(answers)) {
      if (v && (t.includes(k.replace(/_/g, ' ')) || slug(k) === key)) return String(v);
    }
    return null;
  }

  // ------------------------------------------------------------- adapters

  /**
   * Lever's form uses stable `name` attributes, so map those directly and let
   * the generic pass handle the posting-specific custom question cards.
   */
  const LEVER = {
    id: 'lever',
    matches: () => /(^|\.)lever\.co$/.test(location.hostname)
      || Boolean(document.querySelector('form[action*="lever"], .application-form, #application-form')),
    directFields: (p) => ({
      'input[name="name"]': p.identity?.fullName,
      'input[name="email"]': p.identity?.email,
      'input[name="phone"]': p.identity?.phone,
      'input[name="org"]': p.identity?.currentCompany,
      'input[name="urls[LinkedIn]"]': p.links?.linkedin,
      'input[name="urls[Github]"], input[name="urls[GitHub]"]': p.links?.github,
      'input[name="urls[Twitter]"]': p.links?.twitter,
      'input[name="urls[Portfolio]"]': p.links?.portfolio,
      'input[name="urls[Other]"]': p.links?.other,
      'textarea[name="comments"]': p.coverLetter,
    }),
    resumeSelector: 'input[type="file"][name="resume"], input[type="file"]',
    submitSelector:
      'button[type="submit"], input[type="submit"], .template-btn-submit, [data-qa="btn-submit"]',
    applyLinkSelector: 'a[href*="/apply"], .postings-btn, [data-qa="show-page-apply"]',
  };

  /** Greenhouse / Ashby / Workable all respond well to the generic pass. */
  const GENERIC = {
    id: 'generic',
    matches: () => true,
    directFields: () => ({}),
    resumeSelector: 'input[type="file"]',
    submitSelector: 'button[type="submit"], input[type="submit"], button[id*="submit"]',
    applyLinkSelector: 'a[href*="apply"], button[class*="apply"]',
  };

  const ADAPTERS = [LEVER, GENERIC];
  const pickAdapter = () => ADAPTERS.find((a) => a.matches()) || GENERIC;

  // ------------------------------------------------ human-verification gate

  /**
   * Detect a human-verification challenge.
   *
   * The agent deliberately STOPS here and hands off to a person rather than
   * attempting to defeat the check. Solving these is both a terms-of-service
   * problem and an arms race; the supported path for programmatic submission is
   * the ATS vendor's partner API (Lever and Greenhouse both offer one).
   */
  function detectVerification() {
    const SELECTORS = [
      'iframe[src*="recaptcha"]', 'iframe[src*="hcaptcha"]',
      'iframe[src*="challenges.cloudflare.com"]', 'iframe[title*="challenge" i]',
      '.g-recaptcha', '.h-captcha', '.cf-turnstile', '#challenge-form',
      '[data-sitekey]',
    ];
    for (const sel of SELECTORS) {
      const el = document.querySelector(sel);
      if (el && visible(el)) return { present: true, kind: sel, reason: 'challenge-widget' };
    }
    const body = lower(document.body?.innerText || '').slice(0, 4000);
    const PHRASES = [
      'verify you are human', 'are you a robot', 'complete the security check',
      'unusual traffic', 'please verify', 'checking your browser',
    ];
    for (const p of PHRASES) {
      if (body.includes(p)) return { present: true, kind: p, reason: 'challenge-text' };
    }
    return { present: false };
  }

  function detectSuccess() {
    const body = lower(document.body?.innerText || '').slice(0, 4000);
    const PHRASES = ['thank you for applying', 'application submitted', 'application received',
      'thanks for applying', 'we have received your application', 'successfully submitted'];
    const hit = PHRASES.find((p) => body.includes(p));
    return hit ? { ok: true, phrase: hit } : { ok: false };
  }

  // ------------------------------------------------------------ main fill

  async function fillForm(profile, resumeFile) {
    const adapter = pickAdapter();
    const report = { adapter: adapter.id, filled: [], skipped: [], unanswered: [] };

    // Pass 1: adapter-declared fields, keyed by stable name attributes.
    for (const [sel, value] of Object.entries(adapter.directFields(profile))) {
      if (!value) continue;
      const el = document.querySelector(sel);
      if (!el || !visible(el)) continue;
      const ok = await fillText(el, value);
      report.filled.push({ field: sel, value: redact(sel, value), ok, via: 'adapter' });
    }

    // Pass 2: resume upload.
    const fileInput = document.querySelector(adapter.resumeSelector);
    if (fileInput && resumeFile) {
      const ok = await attachFile(fileInput, resumeFile);
      report.filled.push({ field: 'resume', value: resumeFile.filename, ok, via: 'file' });
    } else if (fileInput) {
      report.skipped.push({ field: 'resume', why: 'no resume in profile' });
    }

    // Pass 3: everything else, matched by its question text.
    const controls = [...document.querySelectorAll('input, textarea, select')]
      .filter((el) => visible(el))
      .filter((el) => !['hidden', 'submit', 'button', 'file', 'image'].includes(el.type));

    const radioGroups = new Map();
    for (const el of controls) {
      if (el.type === 'radio' || el.type === 'checkbox') {
        const key = el.name || labelTextFor(el);
        if (!radioGroups.has(key)) radioGroups.set(key, []);
        radioGroups.get(key).push(el);
        continue;
      }
      if (el.value && el.value.trim() !== '') continue;   // already filled in pass 1
      const label = labelTextFor(el);
      const value = valueForLabel(label, profile);
      if (!value) {
        if (isRequired(el)) report.unanswered.push({ field: label || el.name, required: true });
        else report.skipped.push({ field: label || el.name, why: 'no profile value' });
        continue;
      }
      const ok = el.tagName === 'SELECT'
        ? await selectOption(el, value)
        : await fillText(el, value);
      report.filled.push({ field: label || el.name, value: redact(label, value), ok, via: 'inferred' });
    }

    // Pass 4: radio / checkbox groups.
    for (const [key, inputs] of radioGroups) {
      const label = labelTextFor(inputs[0]) || key;
      const groupLabel = groupQuestionText(inputs[0]) || label;
      // A lone checkbox is a consent/acknowledgement box.
      if (inputs.length === 1 && inputs[0].type === 'checkbox') {
        if (/consent|agree|acknowledg|privacy|terms|gdpr/i.test(groupLabel)) {
          inputs[0].checked = true;
          inputs[0].dispatchEvent(new Event('change', { bubbles: true }));
          report.filled.push({ field: groupLabel, value: 'checked', ok: true, via: 'consent' });
        }
        continue;
      }
      const value = valueForLabel(groupLabel, profile);
      if (!value) {
        if (inputs.some(isRequired)) report.unanswered.push({ field: groupLabel, required: true });
        continue;
      }
      const ok = await chooseOption(inputs, value);
      report.filled.push({ field: groupLabel, value, ok, via: 'choice' });
    }

    return report;
  }

  function groupQuestionText(input) {
    const fs = input.closest('fieldset, .application-question, [class*="question"]');
    if (!fs) return null;
    const legend = fs.querySelector('legend, .application-label, label:not([for]), [class*="label"]');
    return legend ? norm(legend.textContent) : null;
  }

  const isRequired = (el) =>
    el.required || el.getAttribute('aria-required') === 'true'
    || Boolean(el.closest('[class*="required"]'));

  /** Keep PII out of the run log; the values still go into the form. */
  function redact(field, value) {
    const f = lower(field);
    if (/e-?mail|phone/.test(f)) {
      const s = String(value);
      return s.length <= 4 ? '***' : s.slice(0, 2) + '***' + s.slice(-2);
    }
    const s = String(value);
    return s.length > 80 ? s.slice(0, 77) + '…' : s;
  }

  // ------------------------------------------------------------ messaging

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    (async () => {
      try {
        if (msg.type === 'PING') return sendResponse({ ok: true, url: location.href });

        if (msg.type === 'FIND_APPLY_LINK') {
          const adapter = pickAdapter();
          const el = [...document.querySelectorAll(adapter.applyLinkSelector)].find(visible);
          return sendResponse({ ok: true, href: el?.href || null, hasForm: hasApplicationForm() });
        }

        if (msg.type === 'FILL') {
          const verification = detectVerification();
          if (verification.present) {
            return sendResponse({ ok: false, status: 'needs_human', verification });
          }
          const report = await fillForm(msg.profile || {}, msg.resume || null);
          return sendResponse({
            ok: true, status: 'filled', report,
            verification: detectVerification(), url: location.href,
          });
        }

        if (msg.type === 'SUBMIT') {
          const verification = detectVerification();
          if (verification.present) {
            return sendResponse({ ok: false, status: 'needs_human', verification });
          }
          const adapter = pickAdapter();
          const btn = [...document.querySelectorAll(adapter.submitSelector)].find(visible);
          if (!btn) return sendResponse({ ok: false, status: 'no_submit_button' });
          btn.scrollIntoView({ block: 'center' });
          await sleep(120);
          btn.click();
          await sleep(2500);
          const after = detectVerification();
          if (after.present) return sendResponse({ ok: false, status: 'needs_human', verification: after });
          return sendResponse({ ok: true, status: 'submitted', success: detectSuccess(), url: location.href });
        }

        if (msg.type === 'STATUS') {
          return sendResponse({
            ok: true, url: location.href, hasForm: hasApplicationForm(),
            verification: detectVerification(), success: detectSuccess(),
          });
        }
        sendResponse({ ok: false, error: `unknown message ${msg.type}` });
      } catch (err) {
        sendResponse({ ok: false, error: String(err && err.stack || err) });
      }
    })();
    return true;   // keep the message channel open for the async reply
  });

  function hasApplicationForm() {
    return Boolean(
      document.querySelector('input[name="email"], input[type="email"]')
      && document.querySelector('input[type="file"], input[name="resume"]'));
  }
})();
