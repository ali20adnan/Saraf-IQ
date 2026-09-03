/** SWITCH / Baly dual JWT slots shown on Saraf boot. Never logs the raw token. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export type SwitchSlot = {
  slot: 1 | 2;
  phone: string;
  set: boolean;
  refreshSet: boolean;
  active: boolean;
};

function firstEnv(...keys: string[]): string {
  for (const key of keys) {
    const val = (process.env[key] || "").trim();
    if (val) return val;
  }
  return "";
}

function loadEnvFile(filePath: string): void {
  if (!existsSync(filePath)) return;
  const text = readFileSync(filePath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const eq = trimmed.indexOf("=");
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (key && process.env[key] === undefined) process.env[key] = val;
  }
}

export function loadSwitchTokenEnv(): void {
  const here = process.cwd();
  const candidates = [
    path.join(here, "tokens.env"),
    path.join(here, "..", "web-jump-baly-master", "tokens.env"),
    path.join(here, ".env"),
  ];
  for (const file of candidates) loadEnvFile(file);
}

function extractJwt(raw: string): string {
  const value = (raw || "").trim();
  if (!value) return "";
  if (value.includes("token=")) {
    try {
      const href = value.startsWith("?")
        ? `https://app.cards.baly.iq/${value}`
        : value;
      const url = new URL(href);
      return url.searchParams.get("token") || "";
    } catch {
      const m = value.match(/token=([^&\s]+)/);
      return m ? decodeURIComponent(m[1]) : "";
    }
  }
  return value;
}

function phoneFromJwt(raw: string): string {
  const jwt = extractJwt(raw);
  const parts = jwt.split(".");
  if (parts.length < 2) return "";
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const payload = JSON.parse(Buffer.from(pad, "base64").toString("utf8"));
    return String(payload.phone || payload.username || "").trim();
  } catch {
    return "";
  }
}

export function activeSwitchSlot(): 1 | 2 {
  const raw = firstEnv("app_tokenactive", "APP_TOKENACTIVE", "APP_TOKEN_ACTIVE") || "1";
  return raw.trim() === "2" ? 2 : 1;
}

export function listSwitchSlots(): SwitchSlot[] {
  const active = activeSwitchSlot();
  return ([1, 2] as const).map((slot) => {
    const url = firstEnv(
      slot === 1 ? "apptokenurl1" : "apptokenurl2",
      slot === 1 ? "APPTOKENURL1" : "APPTOKENURL2",
    );
    const refresh = firstEnv(
      slot === 1 ? "apptokenrefresh1" : "apptokenrefresh2",
      slot === 1 ? "APPTOKENREFRESH1" : "APPTOKENREFRESH2",
    );
    return {
      slot,
      phone: phoneFromJwt(url),
      set: Boolean(extractJwt(url)),
      refreshSet: Boolean(refresh),
      active: slot === active,
    };
  });
}

export function slotFilePath(): string {
  const fromEnv = (process.env.WEBJUMP_TOKEN_SLOT_FILE || "").trim();
  if (fromEnv) return fromEnv;
  const shared = (process.env.WEBJUMP_SHARED_DIR || "").trim();
  if (shared) return path.join(shared, "webjump_token_slot");
  return path.join(process.cwd(), "..", "web-jump-baly-master", ".app_token_active");
}

export function readSwitchSlot(): 1 | 2 {
  try {
    const file = slotFilePath();
    if (existsSync(file)) {
      const raw = readFileSync(file, "utf8").trim();
      if (raw === "2") return 2;
      if (raw === "1") return 1;
    }
  } catch {
    /* ignore */
  }
  return activeSwitchSlot();
}

export function writeSwitchSlot(slot: 1 | 2): void {
  const file = slotFilePath();
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, String(slot), "utf8");
  process.env.app_tokenactive = String(slot);
  process.env.APP_TOKENACTIVE = String(slot);
}

export function tokenSwitchKeyboard(): { text: string; callback_data: string }[][] {
  const slots = listSwitchSlots();
  const active = readSwitchSlot();
  const row = slots.map((s) => {
    const phone = s.phone ? s.phone.replace(/^\+964/, "") : "empty";
    const mark = s.slot === active ? "✅ " : "";
    return {
      text: `${mark}Token ${s.slot} ${phone}`,
      callback_data: `token:${s.slot}`,
    };
  });
  return [row];
}

export function logSwitchTokensOnBoot(): void {
  loadSwitchTokenEnv();
  const active = readSwitchSlot();
  writeSwitchSlot(active);
  const slots = listSwitchSlots();
  console.log("  SWITCH tokens:");
  for (const s of slots) {
    const mark = s.slot === active ? "active" : "standby";
    const phone = s.phone || (s.set ? "(jwt, no phone in payload)" : "(empty)");
    console.log(
      `    Token ${s.slot}  ${mark}  ${phone}  refresh=${s.refreshSet ? "set" : "missing"}`,
    );
  }
}
