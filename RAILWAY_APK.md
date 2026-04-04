# Railway APK Builder

## 🚀 بناء APK على Railway

### **1. إنشاء مشروع جديد في Railway**

1. اذهب إلى [Railway](https://railway.app)
2. اضغط **New Project**
3. اختر **Deploy from GitHub repo**
4. اختر مستودع صراف

### **2. إعدادات المشروع**

في Railway Dashboard:

#### **Variables (متغيرات البيئة):**
```
NODE_VERSION=20
JAVA_VERSION=17
ANDROID_SDK_ROOT=/opt/android-sdk
```

#### **Build Command:**
```bash
chmod +x build-apk.sh && ./build-apk.sh
```

#### **Start Command:**
```bash
echo "APK Builder Ready - APK available for download"
```

---

## 📱 كيف تحصل على APK:

### **الطريقة 1: Railway Public URL**
```bash
https://your-project-name.up.railway.app/saraf-iq-debug.apk
```

### **الطريقة 2: Railway Logs**
1. افتح الـ Logs في Railway
2. ابحث عن "APK available at:"
3. انسخ الرابط

### **الطريقة 3: Railway Storage**
1. اذهب إلى **Storage** tab
2. ابحث عن `saraf-iq-debug.apk`
3. اضغط **Download**

---

## ⚙️ إعدادات إضافية

### **للنسخة Release:**
عدّل `build-apk.sh`:
```bash
./gradlew assembleRelease --stacktrace
```

### **لتخصيص اسم APK:**
```bash
cp $APK_PATH /app/public/saraf-iq-v1.0.apk
```

---

## 🔧 المميزات

| الميزة | Railway |
|--------|---------|
| 🆓 **مجاني** | 500 ساعة/شهر |
| 🚀 **سريع** | بناء في 2-3 دقائق |
| 📱 **APK مباشر** | تحميل من URL |
| 🔄 **تلقائي** | يبني مع كل push |
| 🌍 **بدون VPN** | خوادم Railway سريعة |

---

## 📋 خطوات النشر:

1. **رفع الكود** → `git push`
2. **إنشاء مشروع** في Railway
3. **إضافة متغيرات** البيئة
4. **تشغيل البناء**
5. **تحميل APK**

---

## 🎯 النتيجة النهائية:

- ✅ APK جاهز للتحميل
- ✅ يعمل بدون VPN
- ✅ بناء تلقائي
- ✅ URL مباشر للتحميل

---

**جاهز للنشر على Railway! 🚀**
