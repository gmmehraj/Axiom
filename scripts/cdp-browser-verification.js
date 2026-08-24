const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const CHROME_PATH = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const USER_DATA = path.join(__dirname, '..', 'scratch', 'cdp-profile-' + Date.now());
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
  throw new Error('Could not find page target in Chrome CDP after 30 attempts');
}

class CDPClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 1;
    this.callbacks = new Map();
    this.events = [];
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
        this.events.push(data);
        if (data.method === 'Runtime.consoleAPICalled') {
          const type = data.params.type;
          const text = data.params.args.map(a => a.value || a.description || '').join(' ');
          this.consoleLogs.push({ type, text });
        } else if (data.method === 'Runtime.exceptionThrown') {
          const text = data.params.exceptionDetails?.text || 'Exception';
          const desc = data.params.exceptionDetails?.exception?.description || '';
          this.consoleLogs.push({ type: 'error', text: `${text}: ${desc}` });
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

async function run() {
  console.log(`Starting real browser: ${CHROME_PATH}`);
  const chromeProcess = spawn(CHROME_PATH, [
    '--headless=new',
    '--remote-debugging-port=9222',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${USER_DATA}`,
    'about:blank'
  ], { stdio: 'ignore' });

  try {
    const wsUrl = await getWsUrl(9222);
    console.log(`Connected to Chrome DevTools Protocol at ${wsUrl}`);
    const client = new CDPClient(wsUrl);
    await client.ready();

    // Enable domains
    await client.send('Page.enable');
    await client.send('Runtime.enable');
    await client.send('Network.enable');
    await client.send('Network.clearBrowserCache');
    await client.send('Network.clearBrowserCookies');

    console.log('\n--- 1. Testing Voice Verification Suite in Real Browser ---');
    await client.send('Page.navigate', { url: 'http://localhost:3000/test-evidence/voice-verification-suite.html' });
    
    let verificationResults = null;
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      verificationResults = await client.evaluate('window.__AXIOM_VERIFICATION_RESULTS__');
      if (verificationResults && verificationResults.voiceSteps && verificationResults.voiceSteps.length >= 13) break;
    }
    console.log('\nVoice Verification Suite Result:');
    if (verificationResults) {
      console.log(`  All Passed: ${verificationResults.allPassed}`);
      console.log(`  Console Errors: ${verificationResults.consoleErrors.length}`);
      console.log(`  Network Errors: ${verificationResults.networkErrors.length}`);
      console.log(`  Voice Steps (${verificationResults.voiceSteps.length}):`);
      verificationResults.voiceSteps.forEach(s => {
        console.log(`    [${s.ok ? 'PASS' : 'FAIL'}] ${s.name} -> ${s.details}`);
      });
      console.log(`  Major Pages Voice Control (${verificationResults.pageTests.length}):`);
      verificationResults.pageTests.forEach(p => {
        console.log(`    [${p.ok ? 'PASS' : 'FAIL'}] ${p.page} -> ${p.details}`);
      });
    } else {
      console.error('  Failed to retrieve window.__AXIOM_VERIFICATION_RESULTS__');
    }

    console.log('\n--- 2. Inspecting Individual Major Pages in Real Browser ---');
    const pagesToAudit = [
      'os-shell.html',
      'memory.html',
      'browser.html',
      'playground.html',
      'automation.html',
      'settings.html',
      'analytics.html',
      'billing.html',
      'agent-library.html',
      'brain.html'
    ];

    const auditSummary = [];

    for (const page of pagesToAudit) {
      client.consoleLogs.length = 0;
      client.networkRequests.length = 0;
      const pageUrl = `http://localhost:3000/${page}`;
      await client.send('Page.navigate', { url: pageUrl });
      await sleep(1500);

      // Check for voice controller availability
      const voiceActive = await client.evaluate('!!(window.AxiomHandsFreeVoice && window.AxiomVoiceWebsiteController)');
      const supabaseState = await client.evaluate('typeof window.AxiomSupabaseConnection !== "undefined" ? window.AxiomSupabaseConnection.getState() : "none"');

      // Filter real errors (exclude harmless info logs)
      const pageErrors = client.consoleLogs.filter(l => l.type === 'error');
      const networkErrors = client.networkRequests.filter(r => r.status >= 400);

      console.log(`Page: ${page}`);
      console.log(`  Voice Active: ${voiceActive}`);
      console.log(`  Supabase State: ${JSON.stringify(supabaseState)}`);
      console.log(`  Console Errors: ${pageErrors.length}`);
      if (pageErrors.length > 0) {
        pageErrors.forEach(e => console.log(`    [ERR] ${e.text}`));
      }
      console.log(`  Network Errors (4xx/5xx): ${networkErrors.length}`);
      if (networkErrors.length > 0) {
        networkErrors.forEach(e => console.log(`    [404/ERR] ${e.url} -> Status ${e.status}`));
      }

      auditSummary.push({
        page,
        voiceActive,
        consoleErrors: pageErrors.length,
        networkErrors: networkErrors.length,
        pass: pageErrors.length === 0 && networkErrors.length === 0
      });
    }

    console.log('\n======================================================');
    console.log('FINAL AUDIT SUMMARY:');
    console.table(auditSummary);
    console.log('======================================================');

  } finally {
    chromeProcess.kill();
    try { fs.rmSync(USER_DATA, { recursive: true, force: true }); } catch (e) {}
  }
}

run().catch(err => {
  console.error('Fatal Runner Error:', err);
  process.exit(1);
});
