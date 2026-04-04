# Saraf IQ (صراف)

واجهة React (Vite) + خادم Express. تشغيل محلي:

```bash
npm install
cp .env.example .env.local
# املأ المتغيرات في .env.local ثم:
npm run dev
```

- **محلي:** `http://localhost:3000` (أو `PORT` من البيئة)
- **بناء الإنتاج:** `npm run build`
- **أندرويد:** `npm run build-apk` ثم من مجلد `android`: `./gradlew assembleDebug` (أو `gradlew.bat` على Windows) ونسخ الـ APK حسب الحاجة.

الاختبارات: `npm test`
