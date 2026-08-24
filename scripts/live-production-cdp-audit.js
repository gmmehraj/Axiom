const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const LIVE_URL = 'https://axiom-ayoq0klp3-godofwar11.vercel.app';

const CHROME_PATH = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const USER_DATA = path.join(ROOT, 'scratch', 'cdp-live-profile-' + Date.now());
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
          if (type === 'error') {
            console.log(`[Live Console ERROR] ${text}`);
          }
        } else if (data.method === 'Runtime.exceptionThrown') {
          const text = data.params.exceptionDetails?.text || 'Exception';
          const desc = data.params.exceptionDetails?.exception?.description || '';
          this.consoleLogs.push({ type: 'error', text: `${text}: ${desc}` });
          console.error(`[Live EXCEPTION] ${text}: ${desc}`);
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

async function runLiveAudit() {
  console.log(`Starting real Chrome to audit live Vercel deployment: ${LIVE_URL}`);

  const chromeProcess = spawn(CHROME_PATH, [
    '--headless=new',
    '--remote-debugging-port=9222',
    '--disable-gpu',
    '--disable-extensions',
    '--disable-component-extensions-with-background-pages',
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

    console.log('\n======================================================');
    console.log('AUDITING ALL PAGES ON LIVE VERCEL PRODUCTION DEPLOYMENT');
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
    const pageReports = [];

    for (const page of pages) {
      client.consoleLogs.length = 0;
      client.networkRequests.length = 0;
      await client.send('Network.clearBrowserCache');
      await client.send('Network.clearBrowserCookies');

      const pageUrl = `${LIVE_URL}/${page}`;
      await client.send('Page.navigate', { url: pageUrl });
      await sleep(2000);

      // Collect errors
      const errors = client.consoleLogs.filter(l => l.type === 'error');
      const networkFails = client.networkRequests.filter(r => r.status >= 400);

      const hasVoice = await client.evaluate('!!(window.AxiomHandsFreeVoice || window.JarvisVoiceController || window.AxiomVoiceWebsiteController)');
      const supabaseState = await client.evaluate('typeof window.AxiomSupabaseConnection !== "undefined" ? window.AxiomSupabaseConnection.getState() : "none"');

      console.log(`\nPage: ${page}`);
      console.log(`  Console Errors: ${errors.length}`);
      console.log(`  Network 4xx/5xx Errors: ${networkFails.length}`);
      console.log(`  Voice Module Available: ${hasVoice}`);
      console.log(`  Supabase State: ${JSON.stringify(supabaseState)}`);

      if (errors.length > 0) {
        errors.forEach(e => console.log(`    [CONSOLE ERROR] ${e.text}`));
        totalErrorsAcrossPages += errors.length;
      }
      if (networkFails.length > 0) {
        networkFails.forEach(r => console.log(`    [NETWORK ERROR] ${r.url} -> HTTP ${r.status}`));
        total404sAcrossPages += networkFails.length;
      }

      pageReports.push({
        page,
        consoleErrors: errors.length,
        networkErrors: networkFails.length,
        hasVoice,
        pass: errors.length === 0 && networkFails.length === 0
      });
    }

    console.log('\n======================================================');
    console.log('LIVE VERCEL PRODUCTION SUMMARY');
    console.table(pageReports);
    console.log(`Total Console Errors Across All Live Pages: ${totalErrorsAcrossPages}`);
    console.log(`Total Network 4xx/5xx Errors Across All Live Pages: ${total404sAcrossPages}`);
    console.log('======================================================\n');

  } finally {
    chromeProcess.kill();
    try { fs.rmSync(USER_DATA, { recursive: true, force: true }); } catch (e) {}
  }
}

runLiveAudit().catch(err => {
  console.error('Live audit failed:', err);
  process.exit(1);
});
