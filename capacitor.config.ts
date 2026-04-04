// @ts-nocheck
// Capacitor configuration - only used for mobile builds
// This file is ignored during Railway deployment

const config = {
  appId: 'com.sarafiq.app',
  appName: 'صراف - Saraf IQ',
  webDir: 'dist',
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
