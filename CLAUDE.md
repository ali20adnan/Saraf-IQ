# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Dev (Express + Vite SSR on same process)
npm run dev

# Type-check (no emit)
npm run lint

# Production web build
npm run build

# Build + sync Android + open Android Studio
npm run cap:build

# Build signed APK via Gradle (requires android/keystore.properties)
npm run apk

# Clean dist and Capacitor build artifacts
npm run clean
```

No test suite is configured.

## Architecture

Saraf IQ is an Iraqi currency-exchange web app (buy/sell Asiacell credit in IQD) that also ships as an Android APK via Capacitor. It is a **monorepo** with three runtime layers on a single Node process deployed to Railway:

### 1. Express server (`server.ts` + `server/`)
- Entry: `server.ts` — registers all REST routes and runs the Telegram bot
- **`server/store.ts`** — the entire data layer. All state (transactions, agents, admins, offers, settings, push tokens) lives in a single JSON file at `data/saraf-store.json`. No SQL database is used for transactions; Supabase is only for auth (`profiles` table with `role` column).
- **`server/botMessages.ts`** — Telegram bot message formatters and callback-data parsers
- **`server/pushFcm.ts`** — Firebase Cloud Messaging helpers for native push notifications
- **`server/telegram.ts`** — CJS shim for `node-telegram-bot-api` (ESM compatibility)

In **dev mode**, the same `server.ts` process mounts Vite as middleware (SSR dev proxy). In production, it serves the pre-built `dist/` statically.

### 2. React SPA (`src/`)
- **`src/App.tsx`** is essentially the entire frontend — one enormous component (`MainContent`) containing all views (home, login, signup, admin, history, profile, settings, services). There is no router; views are toggled via `currentView` state.
- **`src/lib/apiBase.ts`** — `apiUrl(path)` resolves the API origin for all `fetch` calls. In dev it returns relative paths; in production it reads from `VITE_APP_API_ORIGIN` env or `public/saraf-api.json` (the APK can't read Railway env vars at runtime).
- **`src/context/LanguageContext.tsx`** — bilingual AR/EN context + `t()` hook; translations in `src/i18n/translations.ts`
- **`src/lib/notifications.ts`** — wraps web Notifications API (browser) and `@capacitor/push-notifications` (APK)

### 3. Capacitor Android (`android/`)
- Source for the `.apk` build. After `npm run build`, `cap sync android` copies `dist/` into the WebView.
- The APK must know the Railway API URL at build time via `android/.env` (sets `VITE_APP_API_ORIGIN`).

## Key Environment Variables

| Variable | Purpose |
|---|---|
| `VITE_SUPABASE_URL` / `SUPABASE_URL` | Supabase project URL (frontend + server) |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key (frontend) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role (server-side auth) |
| `TELEGRAM_BOT_TOKEN` | Telegram bot for order notifications |
| `TELEGRAM_CHAT_ID` | Primary admin chat ID |
| `VITE_APP_API_ORIGIN` | Full Railway URL; required in `android/.env` for APK builds |
| `FCM_SERVICE_ACCOUNT_JSON` | Firebase service account JSON (push notifications) |

## Data Flow for an Order

1. User submits form → `POST /api/transactions` in `server.ts`
2. Transaction written to `data/saraf-store.json` via `store.createTransaction()`
3. Telegram notification sent to all admin chat IDs + active agent
4. For credit-card buys: OTP flow via `POST /api/transactions/otp`
5. Admin/agent updates status via Telegram inline buttons → server updates store → FCM push to client

## Admin Access

`/admin` path triggers admin login view. Admin role is stored in Supabase `profiles.role = 'admin'`. Secondary admins and agents are stored in `data/saraf-store.json`.
