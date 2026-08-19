// ============================================================
// AXIOM — Phase 9 Part 1: Static QA & Regression Audit Suite
// ------------------------------------------------------------
// Whole-project static checks, run directly against the real
// project files on disk (no mocks, no modified copies):
//
//   1. JS syntax validity            — every .js file (node --check)
//   2. Inline <script> block syntax  — every inline block in every .html
//   3. Broken local asset/script refs — src=/href= in every .html
//   4. Duplicate element IDs         — per HTML file, comments excluded
//   5. Unclosed / mismatched HTML tags
//   6. onclick="" handlers resolve to a real, defined JS function
//   7. CSS brace balance             — every .css file
//   8. JSON validity                 — every .json file
//   9. Viewport meta tag present     — every app page (mobile baseline)
//  10. No hardcoded secrets / plaintext API keys
//  11. No insecure (http://) hardcoded external URLs
//
// This suite is intentionally read-only: it never modifies project
// files. It complements (does not replace) the Milestone 5–14
// runtime regression suites, which already cover the AI/runtime
// layer in a Node `vm` sandbox.
// ============================================================
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const failures = [];

function check(label, ok, detail) {
  if (ok) {
    pass++;
    console.log(`PASS  ${label}`);
  } else {
    fail++;
    failures.push({ label, detail });
    console.log(`FAIL  ${label}${detail ? '  — ' + detail : ''}`);
  }
}

function walk(dir, exts, exclude = ['_archive', 'test-evidence', 'node_modules', '.git']) {
  const out = [];
  (function rec(d) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      const rel = path.relative(ROOT, full);
      if (exclude.some(x => rel.startsWith(x) || rel === x || entry.name === x)) continue;
      if (entry.isDirectory()) rec(full);
      else if (exts.includes(path.extname(entry.name))) out.push(full);
    }
  })(dir);
  return out;
}

// ---------------------------------------------------------------
// 1. JS syntax validity (all runtime JS, archive excluded)
// ---------------------------------------------------------------
const jsFiles = walk(ROOT, ['.js'], ['_archive', 'test-evidence', 'node_modules', '.git']);
for (const f of jsFiles) {
  try {
    execSync(`node --check ${JSON.stringify(f)}`, { stdio: 'pipe' });
    check(`JS syntax valid: ${path.relative(ROOT, f)}`, true);
  } catch (e) {
    check(`JS syntax valid: ${path.relative(ROOT, f)}`, false, e.stderr.toString().split('\n')[0]);
  }
}

// ---------------------------------------------------------------
// 2. Inline <script> block syntax
// ---------------------------------------------------------------
const htmlFiles = walk(ROOT, ['.html']);
for (const hf of htmlFiles) {
  const c = fs.readFileSync(hf, 'utf8');
  const blocks = [...c.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];
  blocks.forEach((m, i) => {
    const code = m[1].trim();
    if (!code) return;
    const tmp = path.join(require('os').tmpdir(), `axiom-inline-${path.basename(hf)}-${i}.js`);
    fs.writeFileSync(tmp, code);
    try {
      execSync(`node --check ${JSON.stringify(tmp)}`, { stdio: 'pipe' });
      check(`Inline script valid: ${path.relative(ROOT, hf)} block ${i}`, true);
    } catch (e) {
      check(`Inline script valid: ${path.relative(ROOT, hf)} block ${i}`, false, e.stderr.toString().split('\n')[0]);
    } finally {
      fs.unlinkSync(tmp);
    }
  });
}

// ---------------------------------------------------------------
// 3. Broken local asset/script references
// ---------------------------------------------------------------
for (const hf of htmlFiles) {
  const c = fs.readFileSync(hf, 'utf8');
  const refs = [...c.matchAll(/(?:src|href)=["']([^"']+)["']/g)].map(m => m[1]);
  for (const r of refs) {
    if (/^(https?:)?\/\//.test(r) || r.startsWith('#') || r.startsWith('mailto:') || r.startsWith('data:')) continue;
    const clean = r.split('?')[0].split('#')[0];
    if (!clean) continue;
    const full = path.normalize(path.join(path.dirname(hf), clean));
    check(`Asset resolves: ${path.relative(ROOT, hf)} -> ${r}`, fs.existsSync(full));
  }
}

// ---------------------------------------------------------------
// 4. Duplicate element IDs (comments stripped first)
// ---------------------------------------------------------------
for (const hf of htmlFiles) {
  const c = fs.readFileSync(hf, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const ids = [...c.matchAll(/\bid=["']([^"']+)["']/g)].map(m => m[1]);
  const seen = {};
  ids.forEach(i => { seen[i] = (seen[i] || 0) + 1; });
  const dups = Object.entries(seen).filter(([, n]) => n > 1);
  check(`No duplicate IDs: ${path.relative(ROOT, hf)}`, dups.length === 0, dups.map(d => d.join('x')).join(', '));
}

// ---------------------------------------------------------------
// 5. Unclosed / mismatched HTML tags (lightweight stack parser)
// ---------------------------------------------------------------
const VOID = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
for (const hf of htmlFiles) {
  const c = fs.readFileSync(hf, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const stack = [];
  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*?(\/?)>/g;
  let m, ok = true, detail = '';
  while ((m = tagRe.exec(c))) {
    const [, closing, tag, selfClose] = m;
    const t = tag.toLowerCase();
    if (t === 'script' || t === 'style') {
      // skip content between tags to avoid false matches on < inside JS/CSS
      if (!closing) {
        const endIdx = c.indexOf(`</${t}>`, tagRe.lastIndex);
        if (endIdx !== -1) tagRe.lastIndex = endIdx;
      }
      continue;
    }
    if (VOID.has(t) || selfClose) continue;
    if (!closing) stack.push(t);
    else {
      if (stack.length && stack[stack.length - 1] === t) stack.pop();
      else if (stack.includes(t)) {
        while (stack.length && stack[stack.length - 1] !== t) stack.pop();
        stack.pop();
      } else { ok = false; detail = `unexpected </${t}>`; }
    }
  }
  if (stack.length) { ok = false; detail = `unclosed: ${stack.join(', ')}`; }
  check(`Balanced tags: ${path.relative(ROOT, hf)}`, ok, detail);
}

// ---------------------------------------------------------------
// 6. onclick="" handlers resolve to a defined JS function
// ---------------------------------------------------------------
let allJs = '';
for (const f of jsFiles) allJs += fs.readFileSync(f, 'utf8') + '\n';
const defined = new Set([
  ...[...allJs.matchAll(/function\s+(\w+)\s*\(/g)].map(m => m[1]),
  ...[...allJs.matchAll(/window\.(\w+)\s*=/g)].map(m => m[1]),
  ...[...allJs.matchAll(/const\s+(\w+)\s*=\s*(?:async\s*)?\(/g)].map(m => m[1]),
]);
for (const hf of htmlFiles) {
  const c = fs.readFileSync(hf, 'utf8');
  const handlers = [...c.matchAll(/onclick=["']([^"']+)["']/g)].map(m => m[1]);
  for (const h of handlers) {
    const fnMatch = h.match(/^\s*(\w+)\s*\(/);
    if (!fnMatch) continue;
    const fn = fnMatch[1];
    check(`onclick resolves: ${path.relative(ROOT, hf)} -> ${fn}()`, defined.has(fn));
  }
}

// ---------------------------------------------------------------
// 7. CSS brace balance
// ---------------------------------------------------------------
const cssFiles = walk(ROOT, ['.css']);
for (const f of cssFiles) {
  const c = fs.readFileSync(f, 'utf8');
  const open = (c.match(/{/g) || []).length;
  const close = (c.match(/}/g) || []).length;
  check(`CSS braces balanced: ${path.relative(ROOT, f)}`, open === close, `open=${open} close=${close}`);
}

// ---------------------------------------------------------------
// 8. JSON validity
// ---------------------------------------------------------------
const jsonFiles = walk(ROOT, ['.json']);
for (const f of jsonFiles) {
  try {
    JSON.parse(fs.readFileSync(f, 'utf8'));
    check(`JSON valid: ${path.relative(ROOT, f)}`, true);
  } catch (e) {
    check(`JSON valid: ${path.relative(ROOT, f)}`, false, e.message);
  }
}

// ---------------------------------------------------------------
// 9. Viewport meta tag on every top-level app page
// ---------------------------------------------------------------
const topLevelHtml = fs.readdirSync(ROOT).filter(f => f.endsWith('.html'));
for (const hf of topLevelHtml) {
  const c = fs.readFileSync(path.join(ROOT, hf), 'utf8');
  check(`Viewport meta present: ${hf}`, /name=["']viewport["']/.test(c));
}

// ---------------------------------------------------------------
// 10. No hardcoded plaintext secrets
// ---------------------------------------------------------------
const secretPattern = /\b(sk-[a-zA-Z0-9]{16,}|sk_live_[a-zA-Z0-9]+|AIzaSy[a-zA-Z0-9_-]{20,}|-----BEGIN [A-Z ]+PRIVATE KEY-----)/;
let secretsFound = [];
for (const f of jsFiles) {
  const c = fs.readFileSync(f, 'utf8');
  const m = c.match(secretPattern);
  if (m) secretsFound.push(`${path.relative(ROOT, f)}: ${m[0].slice(0, 12)}...`);
}
check('No hardcoded plaintext API keys/secrets in JS', secretsFound.length === 0, secretsFound.join('; '));

// ---------------------------------------------------------------
// 11. No insecure (http://) hardcoded external URLs
// ---------------------------------------------------------------
let insecure = [];
for (const f of [...jsFiles, ...htmlFiles]) {
  const c = fs.readFileSync(f, 'utf8');
  const matches = [...c.matchAll(/http:\/\/[^\s"'`)]+/g)].map(m => m[0])
    .filter(u => !u.includes('localhost') && !u.includes('127.0.0.1') && !u.includes('w3.org'));
  if (matches.length) insecure.push(`${path.relative(ROOT, f)}: ${matches.join(', ')}`);
}
check('No insecure http:// hardcoded external URLs', insecure.length === 0, insecure.join('; '));

// ---------------------------------------------------------------
console.log('');
console.log(`${pass}/${pass + fail} checks passed.`);
if (fail > 0) {
  console.log('\nFailures:');
  failures.forEach(f => console.log(`  - ${f.label}${f.detail ? ': ' + f.detail : ''}`));
  process.exitCode = 1;
}
