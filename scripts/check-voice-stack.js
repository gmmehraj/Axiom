const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const pages = [
  'index.html', 'os-shell.html', 'memory.html', 'browser.html',
  'playground.html', 'automation.html', 'settings.html', 'analytics.html',
  'billing.html', 'agent-library.html', 'workspace.html', 'brain.html'
];

const voiceScripts = [
  'js/core/voice.js',
  'js/core/voice-controller.js',
  'js/core/elevenlabs-voice.js',
  'js/core/elevenlabs-scribe.js',
  'js/core/elevenlabs-voice-controller.js',
  'js/core/voice-website-controller.js',
  'js/core/voice-ui-bridge.js',
  'js/core/voice-user-greeting.js'
];

console.log('--- Checking Voice Scripts on Major Pages ---');
pages.forEach(p => {
  const content = fs.readFileSync(path.join(ROOT, p), 'utf8');
  console.log(`\n[Page: ${p}]`);
  voiceScripts.forEach(s => {
    const present = content.includes(s);
    console.log(`  ${s}: ${present ? 'YES' : 'NO'}`);
  });
});
