# Saraf IQ — صراف

A mobile-first web app for exchanging and buying/selling Asiacell credit in Iraq. Built with React, Vite, Railway PostgreSQL, and Capacitor (Android).

## Features

- Buy and sell Asiacell credit with multiple payment methods (ZainCash, FastPay, SuperQi, First Iraqi Bank)
- PUBG Mobile UC top-up
- Telegram bot notifications for orders
- Firebase push notifications (Android APK)
- PWA + native Android APK via Capacitor
- Arabic/English UI

## Prerequisites

- Node.js ≥ 20
- Railway PostgreSQL (`DATABASE_URL`)
- A Telegram bot token

## Setup

```bash
npm install
cp .env.example .env
# Fill in your values in .env
npm run dev
```

The dev server starts the Express backend (`server.ts`) which serves both the API and the Vite frontend.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server |
| `npm run build` | Build frontend for production |
| `npm run lint` | Type-check with TypeScript |
| `npm run cap:build` | Build + sync + open Android project |
| `npm run build-apk` | Build a debug APK |

## Android / APK

1. Copy `android/.env.example` → `android/.env` and set `VITE_APP_API_ORIGIN` to your Railway URL.
2. Run `npm run build-apk` (requires Android SDK).

## Environment Variables

See [`.env.example`](.env.example) for all available variables with descriptions.

## Deployment

The app is designed to deploy on [Railway](https://railway.app). Set the environment variables in the Railway dashboard — the server reads them at runtime and exposes safe public values via `/api/public-config`.
