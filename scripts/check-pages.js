const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const pages = [
  'index.html', 'os-shell.html', 'memory.html', 'browser.html',
  'playground.html', 'automation.html', 'settings.html', 'analytics.html',
  'billing.html', 'agent-library.html', 'workspace.html', 'brain.html',
  'admin.html', 'login.html', 'register.html', 'studios.html'
];

console.log('--- Checking all script and link paths in all pages ---');
let missingCount = 0;
let totalChecked = 0;

pages.forEach(p => {
  const filePath = path.join(ROOT, p);
  if (!fs.existsSync(filePath)) {
    console.log(`Page missing: ${p}`);
    return;
  }
  const content = fs.readFileSync(filePath, 'utf8');
  
  // Script tags
  const scriptRegex = /<script\s+[^>]*src=["']([^"']+)["']/gi;
  let m;
  while ((m = scriptRegex.exec(content)) !== null) {
    totalChecked++;
    const src = m[1].split('?')[0];
    if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('//')) {
      continue; // CDN or remote
    }
    const cleanSrc = src.startsWith('/') ? src.slice(1) : src;
    const localTarget = path.join(ROOT, cleanSrc);
    if (!fs.existsSync(localTarget)) {
      console.log(`[${p}] MISSING SCRIPT: ${src} -> ${localTarget}`);
      missingCount++;
    }
  }

  // Link stylesheet tags
  const linkRegex = /<link\s+[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["']/gi;
  while ((m = linkRegex.exec(content)) !== null) {
    totalChecked++;
    const href = m[1].split('?')[0];
    if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('//')) {
      continue;
    }
    const cleanHref = href.startsWith('/') ? href.slice(1) : href;
    const localTarget = path.join(ROOT, cleanHref);
    if (!fs.existsSync(localTarget)) {
      console.log(`[${p}] MISSING STYLESHEET: ${href} -> ${localTarget}`);
      missingCount++;
    }
  }
});

console.log(`\nTotal checked resources: ${totalChecked}, Missing: ${missingCount}`);
