#!/bin/bash

# Railway APK Builder Script
# This script builds Android APK on Railway

echo "🚀 Starting APK Build on Railway..."

# Clean npm cache and modules
echo "🧹 Cleaning npm cache..."
rm -rf node_modules package-lock.json
npm cache clean --force

# Install dependencies
echo "📦 Installing dependencies..."
npm install --no-optional

# Build web app
echo "🏗️ Building web app..."
npm run build

# Install Capacitor CLI globally
echo "⚙️ Installing Capacitor CLI..."
npm install -g @capacitor/cli

# Add Android platform
echo "📱 Adding Android platform..."
npx cap add android || echo "Android platform already exists"

# Sync Capacitor
echo "🔄 Syncing Capacitor..."
npx cap sync android

# Build APK
echo "🔨 Building APK..."
cd android
chmod +x gradlew
./gradlew assembleDebug --stacktrace

# Get APK info
APK_PATH="app/build/outputs/apk/debug/app-debug.apk"
if [ -f "$APK_PATH" ]; then
    echo "✅ APK Build Successful!"
    echo "📱 APK Size: $(ls -lh $APK_PATH | awk '{print $5}')"
    echo "📍 APK Path: $APK_PATH"
    
    # Copy APK to public folder for download
    cp $APK_PATH /app/public/saraf-iq-debug.apk
    echo "🔗 APK available at: /saraf-iq-debug.apk"
else
    echo "❌ APK Build Failed!"
    exit 1
fi
