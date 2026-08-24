const token = process.env.VERCEL_TOKEN;

async function check() {
  console.log('Checking Vercel deployments...');
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 2500));
    try {
      const res = await fetch('https://api.vercel.com/v6/deployments?projectId=prj_801dGX2clXlPX7Dwk40OThmSBytK&limit=5', {
        headers: { Authorization: 'Bearer ' + token }
      });
      if (res.ok) {
        const data = await res.json();
        const latest = data.deployments && data.deployments[0];
        if (latest) {
          const sha = latest.meta?.githubCommitSha || '';
          const state = latest.state || latest.readyState;
          console.log(`[Poll ${i + 1}] Deployment: ${latest.id} | SHA: ${sha.slice(0, 7)} | State: ${state} | URL: ${latest.url}`);
          if (sha.startsWith('3d7988e') && state === 'READY') {
            console.log('\nSUCCESS: Vercel production deployment is READY!');
            console.log('Final Deployed URL:', `https://${latest.url}`);
            return latest;
          }
        }
      } else {
        console.log(`HTTP error fetching deployments: ${res.status}`);
      }
    } catch (err) {
      console.log('Fetch error:', err.message);
    }
  }
}

check();
