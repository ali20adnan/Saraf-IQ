/**
 * ينسخ app-debug.apk إلى public/saraf-iq-debug.apk لرفعه مع npm run build على Railway.
 * يشغّل بعد: (من جذر المشروع) cd android && .\gradlew.bat assembleDebug
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const src = path.join(root, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
const dest = path.join(root, 'public', 'saraf-iq-debug.apk');

if (!fs.existsSync(src)) {
  console.error(`
لم يُعثر على ملف البناء. ابنِ الـ APK أولاً من مجلد android:

  Windows (من جذر المشروع):
    cd android
    gradlew.bat assembleDebug

  أو من Android Studio: Build → Build Bundle(s) / APK(s) → Build APK(s)

المسار المتوقع:
  ${src}
`);
  process.exit(1);
}

fs.mkdirSync(path.dirname(dest), {recursive: true});
fs.copyFileSync(src, dest);
const mb = (fs.statSync(dest).size / (1024 * 1024)).toFixed(2);
console.log(`تم النسخ (${mb} MB) → ${dest}
الخطوات التالية:
  npm run build
  git add public/saraf-iq-debug.apk
  git commit -m "Add APK for download"
  git push
`);
