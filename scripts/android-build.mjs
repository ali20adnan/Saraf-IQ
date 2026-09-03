/** يحمّل android/.env (override) ثم vite build مباشرة + cap sync — يتفادى فقدان VITE_* عبر npm run build */
import {config} from 'dotenv';
import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const envPath = resolve(root, 'android', '.env');

if (existsSync(envPath)) {
  const r = config({path: envPath, override: true});
  if (r.error) {
    console.warn('[android-build] تعذّر قراءة android/.env:', r.error.message);
  } else {
    console.log('[android-build] تم تحميل android/.env (override)');
    if (process.env.VITE_APP_API_ORIGIN) {
      console.log('[android-build] VITE_APP_API_ORIGIN=', process.env.VITE_APP_API_ORIGIN);
    }
  }
} else {
  console.log('[android-build] لا يوجد android/.env — الاحتياط: public/saraf-api.json في الواجهة');
}

const shell = process.platform === 'win32';
const env = {...process.env};

function run(label, cmd, args) {
  const result = spawnSync(cmd, args, {
    cwd: root,
    stdio: 'inherit',
    shell,
    env,
  });
  if (result.status !== 0) {
    console.error(`[android-build] فشل: ${label}`);
    process.exit(result.status ?? 1);
  }
}

run('vite build', 'npx', ['vite', 'build']);
run('cap sync android', 'npx', ['cap', 'sync', 'android']);
