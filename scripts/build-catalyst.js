// Builds the folder that is uploaded to Zoho Catalyst AppSail: catalyst-build/
//   node scripts/build-catalyst.js        (or: npm run build:catalyst)
// It copies the app and your PRIVATE files (real roster, e-mail and Supabase settings — they go to Zoho
// only, never to GitHub) and installs the runtime packages. Then deploy with: catalyst deploy appsail
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'catalyst-build');

const copy = (rel) => {
  const src = path.join(ROOT, rel);
  if (!fs.existsSync(src)) return false;
  fs.cpSync(src, path.join(OUT, rel), { recursive: true });
  return true;
};

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
['server.js', 'lib', 'public'].forEach(copy);
const priv = { roster: copy('lib/seed.private.js'), smtp: copy('smtp.config.json'), supabase: copy('supabase.config.json') };

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
delete pkg.scripts;
// Only what the server needs at runtime (the Supabase client). @supabase/ssr is for Next.js and not used.
pkg.dependencies = { '@supabase/supabase-js': (pkg.dependencies || {})['@supabase/supabase-js'] || '^2.118.0' };
if (process.env.STORAGE === 'catalyst') pkg.dependencies['@zcatalyst/stratus'] = '^1.0.0';
fs.writeFileSync(path.join(OUT, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');

console.log('Installing runtime packages into catalyst-build …');
execSync('npm install --omit=dev --no-audit --no-fund', { cwd: OUT, stdio: 'inherit' });

console.log('\n✔ catalyst-build is ready');
console.log(`  Real UU-10 roster included: ${priv.roster ? 'yes' : 'NO — sample students will be used'}`);
console.log(`  E-mail settings included:   ${priv.smtp ? 'yes' : 'no — set SMTP_* in app-config.json or the Catalyst console'}`);
console.log(`  Supabase settings included: ${priv.supabase ? 'yes' : 'NO — the app cannot reach its database'}`);
console.log('  Next: catalyst deploy appsail --name uu-bus-erp');
