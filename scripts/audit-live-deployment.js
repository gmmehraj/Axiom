const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://axiom-8ssuklywc-godofwar11.vercel.app';
const pages = [
  'index.html', 'os-shell.html', 'memory.html', 'browser.html',
  'playground.html', 'automation.html', 'settings.html', 'analytics.html',
  'billing.html', 'agent-library.html', 'workspace.html', 'brain.html',
  'admin.html', 'login.html', 'register.html', 'studios.html'
];

async function main() {
  console.log(`Auditing live Vercel deployment: ${BASE_URL}\n`);
  let totalErrors = 0;
  let totalRequests = 0;

  for (const page of pages) {
    const pageUrl = `${BASE_URL}/${page}`;
    totalRequests++;
    try {
      const res = await fetch(pageUrl);
      if (!res.ok) {
        console.error(`[PAGE FAIL] ${pageUrl} -> HTTP ${res.status}`);
        totalErrors++;
        continue;
      }
      const html = await res.text();
      console.log(`[PAGE OK] ${page} (${res.status}, ${html.length} bytes)`);

      // Extract all script, link, img, audio, video tags
      const scriptRegex = /<script\s+[^>]*src=["']([^"']+)["']/gi;
      const linkRegex = /<link\s+[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["']/gi;

      const assets = new Set();
      let m;
      while ((m = scriptRegex.exec(html)) !== null) assets.add(m[1]);
      while ((m = linkRegex.exec(html)) !== null) assets.add(m[1]);

      for (const asset of assets) {
        if (asset.startsWith('http://') || asset.startsWith('https://') || asset.startsWith('//')) {
          continue;
        }
        totalRequests++;
        const assetUrl = `${BASE_URL}/${asset.replace(/^\.?\//, '')}`;
        try {
          const aRes = await fetch(assetUrl);
          if (!aRes.ok) {
            console.error(`  [ASSET 404] ${page} -> ${assetUrl} -> HTTP ${aRes.status}`);
            totalErrors++;
          } else {
            const contentType = aRes.headers.get('content-type') || '';
            // Check MIME-type sanity
            if (asset.endsWith('.js') && !contentType.includes('javascript')) {
              console.warn(`  [MIME WARN] ${assetUrl} -> Content-Type: ${contentType}`);
            }
          }
        } catch (err) {
          console.error(`  [ASSET ERR] ${assetUrl} -> ${err.message}`);
          totalErrors++;
        }
      }
    } catch (err) {
      console.error(`[PAGE ERR] ${pageUrl} -> ${err.message}`);
      totalErrors++;
    }
  }

  console.log(`\n========================================`);
  console.log(`Total live HTTP requests: ${totalRequests}`);
  console.log(`Total live HTTP errors: ${totalErrors}`);
  console.log(`========================================`);
}

main();
