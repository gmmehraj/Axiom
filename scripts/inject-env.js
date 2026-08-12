const fs = require('fs');
const path = require('path');

const required = ['SUPABASE_URL', 'SUPABASE_ANON_KEY'];
const missing = required.filter((key) => !process.env[key]);

if (missing.length) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

// Only browser-safe Supabase values are injected into the client bundle.
// Never read or expose SUPABASE_SERVICE_ROLE_KEY or OPENROUTER_API_KEY here.
const outputDir = path.join(__dirname, '..', 'js', 'core');
const outputFile = path.join(outputDir, 'env.config.js');

const envConfig = `// Generated at build time by scripts/inject-env.js. Do not commit this file.\nwindow.__AXIOM_ENV__ = ${JSON.stringify(
  {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
  },
  null,
  2,
)};\n`;

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(outputFile, envConfig, 'utf8');

console.log(`Injected public Supabase environment into ${path.relative(process.cwd(), outputFile)}`);
