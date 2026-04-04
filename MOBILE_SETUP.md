# تحويل تطبيق صراف إلى APK (Capacitor)

## الملخص
تم إعداد المشروع للتحويل إلى تطبيق Android باستخدام **Capacitor** مع تحسينات متنقلة احترافية.

---

## ✅ ما تم إنجازه

### 1. إعداد Capacitor
- ✅ إضافة `@capacitor/core` و `@capacitor/android`
- ✅ إضافة `@capacitor/cli` للبناء
- ✅ إنشاء `capacitor.config.ts`
- ✅ إضافة سكربتات البناء في `package.json`

### 2. تحسينات تجربة الموبايل
- ✅ **MobileBottomNav** - شريط تنقل سفلي مع:
  - اختفاء/ظهور عند التمرير
  - اهتزاز haptic عند الضغط
  - رسوم متحركة smooth
  - Safe area للأجهزة الحديثة
- ✅ **PullToRefresh** - سحب للتحديث
- ✅ **Haptics** - اهتزازات للتفاعل
- ✅ **Status Bar** - إعدادات شريط الحالة

### 3. إشعارات Push
- ✅ إعداد `@capacitor/push-notifications`
- ✅ إشعارات عند اكتمال/فشل الطلبات

---

## 📦 الملفات الجديدة

```
src/
  components/
    MobileBottomNav.tsx    # شريط تنقل سفلي
    PullToRefresh.tsx      # سحب للتحديث
  lib/
    haptics.ts             # اهتزازات
    notifications.ts       # إشعارات

capacitor.config.ts         # إعدادات Capacitor
```

---

## 🚀 خطوات البناء (Build APK)

### 1. تثبيت المتطلبات
```bash
# تثبيت الحزم
npm install

# تثبيت Android Studio من:
# https://developer.android.com/studio
```

### 2. إضافة Android Platform
```bash
npm run cap:android
```

### 3. بناء التطبيق
```bash
npm run cap:build
```

### 4. في Android Studio:
1. افتح المجلد `android/`
2. انتظر Gradle Sync
3. اذهب إلى **Build** → **Build Bundle(s) / APK(s)** → **Build APK(s)**
4. ستجد الـ APK في: `android/app/build/outputs/apk/debug/app-debug.apk`

---

## 🔐 التوقيع للنشر (Google Play)

### 1. إنشاء Keystore
```bash
keytool -genkey -v -keystore saraf-release.keystore -alias saraf -keyalg RSA -keysize 2048 -validity 10000
```

### 2. تحديث capacitor.config.ts
```typescript
android: {
  buildOptions: {
    keystorePath: './saraf-release.keystore',
    keystoreAlias: 'saraf',
  },
}
```

### 3. بناء Release APK
```bash
cd android
./gradlew assembleRelease
```

---

## 📱 ميزات الموبايل

| الميزة | الوصف |
|--------|-------|
| **شريط تنقل سفلي** | سهل الوصول بالإبهام |
| **سحب للتحديث** | Pull-to-refresh للبيانات |
| **اهتزاز Haptic** | تغذية راجعة عند الضغط |
| **Safe Area** | دعم Notch وشريط التنقل |
| **إشعارات Push** | تنبيهات عند تحديث الطلبات |
| **Status Bar** | لون متوافق مع التطبيق |

---

## 🌐 نشر على Google Play

### 1. إنشاء حساب مطور
- https://play.google.com/console
- رسوم التسجيل: $25 (مرة واحدة)

### 2. إنشاء تطبيق جديد
- املأ بيانات التطبيق
- ارفع APK/AAB
- أضف صور ولقطة شاشة

### 3. متطلبات النشر
| الملف | الحجم |
|-------|-------|
| أيقونة 512x512 | PNG |
| صورة مميزة 1024x500 | JPEG/PNG |
| لقطات شاشة | 3-8 صور |

---

## ⚠️ ملاحظات مهمة

### قبل البناء:
1. ✅ تأكد من `npm install`
2. ✅ تأكد من البيئة (`.env`) تحتوي على:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`

### للاختبار:
```bash
# تشغيل على جهاز حقيقي
npm run cap:open
# ثم اضغط على Run في Android Studio
```

---

## 🔧 إصلاح مشاكل شائعة

### مشكلة: `Cannot find module '@capacitor/cli'`
```bash
npm install
```

### مشكلة: Gradle sync failed
```bash
cd android
./gradlew clean
./gradlew build
```

### مشكلة: الكود لا يعمل على الموبايل
- تأكد من أن API URL يبدأ بـ `https://`
- لا تستخدم `localhost` في الإنتاج

---

## 📞 دعم Capacitor

- الوثائق: https://capacitorjs.com/docs
- المجتمع: https://forum.ionicframework.com/c/capacitor

---

**جاهز للنشر! 🚀**
