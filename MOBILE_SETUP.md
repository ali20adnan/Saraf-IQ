# تحويل تطبيق صراف إلى APK (Capacitor)

## الملخص
المشروع مهيأ لبناء تطبيق Android عبر **Capacitor** مع شريط تنقل سفلي، اهتزاز، إشعارات، وشريط حالة.

---

## ما يتضمنه الموبايل

### Capacitor
- `@capacitor/core`، `@capacitor/android`، `@capacitor/cli`
- `capacitor.config.ts` وسكربتات في `package.json`

### تجربة الاستخدام
- **MobileBottomNav** — تنقل سفلي ثابت، اهتزاز عند الضغط، دعم المنطقة الآمنة
- **Haptics** — تغذية لمسية
- **Status Bar** — من `capacitor.config.ts`
- **Push notifications** — عبر `@capacitor/push-notifications` و`src/lib/notifications.ts`

---

## هيكل مفيد

```
src/components/MobileBottomNav.tsx
src/lib/haptics.ts
src/lib/notifications.ts
capacitor.config.ts
android/
```

---

## بناء الويب ثم مزامنة أندرويد

```bash
npm install
npm run build-apk
```

ثم من مجلد `android` (على Linux/macOS: `./gradlew assembleDebug` — على Windows: `gradlew.bat assembleDebug`). يمكن فتح المشروع بـ `npm run cap:open` واستخدام Android Studio.

للمزامنة والفتح معاً: `npm run cap:build`

إضافة منصة Android لأول مرة فقط: `npm run cap:android`

---

## توقيع Release (Google Play)

```bash
keytool -genkey -v -keystore saraf-release.keystore -alias saraf -keyalg RSA -keysize 2048 -validity 10000
```

حدّث `keystorePath` / `keystoreAlias` في `capacitor.config.ts` ثم `cd android && ./gradlew assembleRelease`.

---

## ملاحظات

- للإنتاج لا تستخدم `localhost` في عناوين API؛ استخدم HTTPS.
- متغيرات `VITE_*` تُدمج عند `npm run build`.

الوثائق الرسمية: [capacitorjs.com/docs](https://capacitorjs.com/docs)
