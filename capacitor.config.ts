// @ts-nocheck
// Capacitor configuration - only used for mobile builds
// This file is ignored during Railway deployment

const config = {
  appId: 'com.sarafiq.app',
  appName: 'صراف - Saraf IQ',
  webDir: 'dist',
  /** للـ APK: عيّن في .env عند البناء VITE_APP_API_ORIGIN=رابط_Railway لقراءة Supabase من /api/public-config */
  server: {
    androidScheme: 'https',
  },
  android: {
    buildOptions: {
      keystorePath: undefined,
      keystoreAlias: undefined,
    },
  },
  plugins: {
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#ffffff',
      overlaysWebView: false,
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

export default config;
