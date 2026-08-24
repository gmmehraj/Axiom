const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PORT = 5055;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf'
};

function createServer() {
  return http.createServer((req, res) => {
    let reqPath = decodeURIComponent(req.url.split('?')[0]);
    if (reqPath === '/') reqPath = '/index.html';
    
    let filePath = path.join(ROOT, reqPath);
    if (!fs.existsSync(filePath) && fs.existsSync(filePath + '.html')) {
      filePath = filePath + '.html';
    }

    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end(`404 Not Found: ${reqPath}`);
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const content = fs.readFileSync(filePath);
    res.writeHead(200, {
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache'
    });
    res.end(content);
  });
}

const CHROME_PATH = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const USER_DATA = path.join(ROOT, 'scratch', 'cdp-test-profile-' + Date.now());
fs.mkdirSync(USER_DATA, { recursive: true });

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getWsUrl(port = 9222) {
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (res.ok) {
        const list = await res.json();
        const page = list.find(t => t.type === 'page');
        if (page && page.webSocketDebuggerUrl) {
          return page.webSocketDebuggerUrl;
        }
      }
    } catch (e) {}
    await sleep(300);
  }
  throw new Error('Could not find page target in Chrome CDP');
}

class CDPClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 1;
    this.callbacks = new Map();
    this.consoleLogs = [];
    this.networkRequests = [];

    this.ws.onmessage = (msg) => {
      const data = JSON.parse(msg.data);
      if (data.id && this.callbacks.has(data.id)) {
        const { resolve, reject } = this.callbacks.get(data.id);
        this.callbacks.delete(data.id);
        if (data.error) reject(data.error);
        else resolve(data.result);
      } else if (data.method) {
        if (data.method === 'Runtime.consoleAPICalled') {
          const type = data.params.type;
          const text = data.params.args.map(a => a.value || a.description || JSON.stringify(a)).join(' ');
          this.consoleLogs.push({ type, text });
          console.log(`[Browser Console ${type.toUpperCase()}] ${text}`);
        } else if (data.method === 'Runtime.exceptionThrown') {
          const text = data.params.exceptionDetails?.text || 'Exception';
          const desc = data.params.exceptionDetails?.exception?.description || '';
          this.consoleLogs.push({ type: 'error', text: `${text}: ${desc}` });
          console.error(`[Browser EXCEPTION] ${text}: ${desc}`);
        } else if (data.method === 'Network.responseReceived') {
          const res = data.params.response;
          this.networkRequests.push({ url: res.url, status: res.status, mime: res.mimeType });
        }
      }
    };
  }

  async ready() {
    return new Promise((resolve) => {
      if (this.ws.readyState === WebSocket.OPEN) resolve();
      else this.ws.onopen = () => resolve();
    });
  }

  async send(method, params = {}) {
    await this.ready();
    const id = this.id++;
    return new Promise((resolve, reject) => {
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (res.exceptionDetails) {
      throw new Error(`Eval Exception: ${res.exceptionDetails.text} - ${res.exceptionDetails.exception?.description}`);
    }
    return res.result?.value;
  }
}

async function runAudit() {
  const server = createServer();
  await new Promise(resolve => server.listen(PORT, '127.0.0.1', resolve));
  console.log(`Local verification server running on http://127.0.0.1:${PORT}`);

  const chromeProcess = spawn(CHROME_PATH, [
    '--headless=new',
    '--remote-debugging-port=9222',
    '--disable-gpu',
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${USER_DATA}`,
    'about:blank'
  ], { stdio: 'ignore' });

  try {
    const wsUrl = await getWsUrl(9222);
    console.log(`Connected to Chrome CDP at ${wsUrl}`);
    const client = new CDPClient(wsUrl);
    await client.ready();

    await client.send('Page.enable');
    await client.send('Runtime.enable');
    await client.send('Network.enable');

    // Test Voice Lifecycle Suite
    console.log('\n======================================================');
    console.log('1. RUNNING COMPLETE VOICE LIFECYCLE IN REAL CHROME');
    console.log('======================================================');
    await client.send('Network.clearBrowserCache');
    await client.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/test-evidence/voice-verification-suite.html` });

    let verificationResults = null;
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      const stateDebug = await client.evaluate(`({
        readyState: document.readyState,
        hasHandsFree: !!window.AxiomHandsFreeVoice,
        hasVoiceController: !!window.JarvisVoiceController,
        hasBrain: !!window.AxiomBrain,
        voiceState: document.documentElement.dataset.axiomVoiceState,
        results: window.__AXIOM_VERIFICATION_RESULTS__
      })`);
      console.log(`[Suite Poll ${i + 1}] State:`, JSON.stringify(stateDebug));
      if (stateDebug && stateDebug.results && stateDebug.results.voiceSteps && stateDebug.results.voiceSteps.length >= 13) {
        verificationResults = stateDebug.results;
        break;
      }
    }

    if (!verificationResults) {
      const pageHtml = await client.evaluate('document.body.innerHTML');
      console.log('Page HTML:', pageHtml);
      throw new Error('Verification suite did not complete in time');
    }

    console.log(`\nVoice Lifecycle Results:`);
    verificationResults.voiceSteps.forEach((s, idx) => {
      console.log(`  Step ${idx + 1}: [${s.ok ? 'PASS' : 'FAIL'}] ${s.name} -> ${s.details}`);
    });

    console.log(`\nMajor Pages Voice Navigation Results:`);
    verificationResults.pageTests.forEach(p => {
      console.log(`  Page [${p.page}]: [${p.ok ? 'PASS' : 'FAIL'}] -> ${p.details}`);
    });

    console.log('\n======================================================');
    console.log('2. AUDITING ALL MAJOR PAGES FOR ERRORS & INITIALIZATION');
    console.log('======================================================');

    const pages = [
      'index.html',
      'os-shell.html',
      'memory.html',
      'browser.html',
      'playground.html',
      'automation.html',
      'settings.html',
      'analytics.html',
      'billing.html',
      'agent-library.html',
      'workspace.html',
      'brain.html',
      'admin.html',
      'login.html',
      'register.html',
      'studios.html'
    ];

    let totalErrorsAcrossPages = 0;
    let total404sAcrossPages = 0;

    for (const page of pages) {
      client.consoleLogs.length = 0;
      client.networkRequests.length = 0;
      await client.send('Network.clearBrowserCache');
      await client.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/${page}` });
      await sleep(1200);

      // Collect errors
      const errors = client.consoleLogs.filter(l => l.type === 'error');
      const networkFails = client.networkRequests.filter(r => r.status >= 400);

      const hasVoice = await client.evaluate('!!(window.AxiomHandsFreeVoice || window.JarvisVoiceController || window.AxiomVoiceWebsiteController)');
      const hasSupabase = await client.evaluate('typeof window.AxiomSupabaseConnection !== "undefined"');

      console.log(`\nPage: ${page}`);
      console.log(`  Console Errors: ${errors.length}`);
      console.log(`  Network 4xx/5xx Errors: ${networkFails.length}`);
      console.log(`  Voice Module Available: ${hasVoice}`);
      console.log(`  Supabase Module Available: ${hasSupabase}`);

      if (errors.length > 0) {
        errors.forEach(e => console.log(`    [CONSOLE ERROR] ${e.text}`));
        totalErrorsAcrossPages += errors.length;
      }
      if (networkFails.length > 0) {
        networkFails.forEach(r => console.log(`    [NETWORK ERROR] ${r.url} -> HTTP ${r.status}`));
        total404sAcrossPages += networkFails.length;
      }
    }

    console.log('\n======================================================');
    console.log('VERIFICATION SUMMARY');
    console.log(`Total Console Errors Across All Pages: ${totalErrorsAcrossPages}`);
    console.log(`Total Network Failures Across All Pages: ${total404sAcrossPages}`);
    console.log(`Voice Suite All Passed: ${verificationResults.allPassed}`);
    console.log('======================================================\n');

  } finally {
    chromeProcess.kill();
    server.close();
    try { fs.rmSync(USER_DATA, { recursive: true, force: true }); } catch (e) {}
  }
}

runAudit().catch(err => {
  console.error('Audit failed:', err);
  process.exit(1);
});
