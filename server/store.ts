import * as fs from "node:fs";
import * as path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { ServerTransaction } from "../types/transaction.js";

export type { ServerTransaction };

export type ServerOffer = {
  id: string;
  variant: "buy" | "sell";
  title_ar: string;
  title_en: string;
  amount_display: string;
  unit_ar: string;
  unit_en: string;
  sort_order: number;
};

export type SiteProfile = {
  full_name: string;
  email: string;
  phone: string;
};

export type Agent = {
  id: string;
  telegram_id: number;
  name: string;
  is_active: boolean;
  permissions: string[]; // ['add_number', 'reset_balance', 'method_zaincash', ...]
  created_at: string;
};

export type Admin = {
  id: string;
  telegram_id: number;
  name: string;
  email?: string | null;
  permissions: string[]; // ['manage_agents', 'site_settings', 'edit_links', 'manage_admins', 'view_stats']
  created_at: string;
};

export type AgentNumber = {
  id: string;
  agent_id: string;
  phone_number: string;
  balance: number;
  is_exhausted: boolean;
  sort_order: number;
};

export type AgentPaymentMethodKey = "zaincash" | "superqi" | "firstbank" | "fastpay";
/** Built-in keys + optional admin-defined wallets: wallet_<slug> */
export type AgentPaymentMethodKeyAny = AgentPaymentMethodKey | string;
export type AgentPaymentMethod = {
  id: string;
  agent_id: string;
  method_key: string;
  account_number: string;
  account_holder: string | null;
  barcode_url: string | null;
  updated_at: string;
};

export type BuyCustomWallet = {
  id: string;
  name_ar: string;
  name_en: string;
  enabled: boolean;
  /** رابط https خارجي أو مسار مرفوع على الخادم: `/uploads/buy-wallet-icons/<id>.png` */
  icon_url?: string | null;
};

/** محافظ بيع إضافية — نفس الشكل؛ المفتاح الفني `sell_wallet_<id>` */
export type SellCustomWallet = BuyCustomWallet;

export type ManagedService = {
  id: string;
  titleAr: string;
  titleEn: string;
  descriptionAr: string;
  descriptionEn: string;
  coverImage: string;
  badgeAr: string;
  badgeEn: string;
  actionType: "pubg_uc" | "coming_soon";
  enabled: boolean;
  comingSoon: boolean;
  sortOrder: number;
};

export type ManagedPubgPackage = {
  id: string;
  label: string;
  totalUc: number;
  priceIqd: number;
  isMinimum: boolean;
  iconTier: 1 | 2 | 3;
  enabled: boolean;
  sortOrder: number;
};

export type BotUser = {
  id: string; // uuid
  telegram_id: number;
  created_at: string;
};

export type PushTokenRecord = {
  token: string;
  client_id: string;
  platform: string;
  updated_at: string;
};

type FileStore = {
  transactions: ServerTransaction[];
  offers: ServerOffer[];
  site_profile: SiteProfile;
  app_settings: Record<string, string>;
  agents: Agent[];
  agent_numbers: AgentNumber[];
  agent_payment_methods: AgentPaymentMethod[];
  admins: Admin[];
  bot_users: BotUser[];
  push_tokens: PushTokenRecord[];
};

const DATA_DIR = path.join(process.cwd(), "data");
const BUY_WALLET_ICONS_DIR = path.join(DATA_DIR, "buy-wallet-icons");
const SELL_WALLET_ICONS_DIR = path.join(DATA_DIR, "sell-wallet-icons");

export function ensureBuyWalletIconsDir(): void {
  fs.mkdirSync(BUY_WALLET_ICONS_DIR, { recursive: true });
}

export function ensureSellWalletIconsDir(): void {
  fs.mkdirSync(SELL_WALLET_ICONS_DIR, { recursive: true });
}

export function buyWalletIconDiskPath(walletId: string): string {
  return path.join(BUY_WALLET_ICONS_DIR, `${walletId}.png`);
}

export function sellWalletIconDiskPath(walletId: string): string {
  return path.join(SELL_WALLET_ICONS_DIR, `${walletId}.png`);
}

/** مسار العلني المحفوظ في JSON بعد رفع PNG من لوحة الإدارة */
export function buyWalletIconPublicPath(walletId: string): string {
  return `/uploads/buy-wallet-icons/${walletId}.png`;
}

export function sellWalletIconPublicPath(walletId: string): string {
  return `/uploads/sell-wallet-icons/${walletId}.png`;
}

const DATA_FILE = path.join(DATA_DIR, "saraf-store.json");
const TX_META_PREFIX = "\n__saraf_meta__:";

function encodeTxDetails(details: string | undefined, meta: { user_name?: string | null; user_ip?: string | null }): string | null {
  const base = (details || "").trim();
  const payload: Record<string, string> = {};
  if (meta.user_name && meta.user_name.trim()) payload.user_name = meta.user_name.trim();
  if (meta.user_ip && meta.user_ip.trim()) payload.user_ip = meta.user_ip.trim();
  if (Object.keys(payload).length === 0) return base || null;
  return `${base}${TX_META_PREFIX}${JSON.stringify(payload)}`;
}

function parseTxDetails(raw: string | null | undefined): {
  cleanDetails: string | null;
  user_name: string | null;
  user_ip: string | null;
} {
  const text = String(raw ?? "");
  const idx = text.lastIndexOf(TX_META_PREFIX);
  if (idx === -1) {
    return { cleanDetails: text || null, user_name: null, user_ip: null };
  }
  const clean = text.slice(0, idx).trim();
  const metaRaw = text.slice(idx + TX_META_PREFIX.length).trim();
  try {
    const meta = JSON.parse(metaRaw) as { user_name?: string; user_ip?: string };
    return {
      cleanDetails: clean || null,
      user_name: meta.user_name?.trim() || null,
      user_ip: meta.user_ip?.trim() || null,
    };
  } catch {
    return { cleanDetails: text || null, user_name: null, user_ip: null };
  }
}

function normalizeTx(tx: ServerTransaction): ServerTransaction {
  const parsed = parseTxDetails(tx.details);
  return {
    ...tx,
    details: parsed.cleanDetails,
    user_name: tx.user_name ?? parsed.user_name ?? null,
    user_ip: tx.user_ip ?? parsed.user_ip ?? null,
  };
}

const defaultOffers: ServerOffer[] = [
  {
    id: "seed-1",
    variant: "sell",
    title_ar: "بيع 100 ألف اسيا بـ 95 ألف",
    title_en: "Sell 100k Asiacell for 95k IQD",
    amount_display: "95,000",
    unit_ar: "دينار",
    unit_en: "IQD",
    sort_order: 1,
  },
  {
    id: "seed-2",
    variant: "buy",
    title_ar: "شراء 100 ألف اسيا بـ 98 ألف",
    title_en: "Buy 100k Asiacell for 98k IQD",
    amount_display: "100,000",
    unit_ar: "اسيا سيل",
    unit_en: "Asiacell",
    sort_order: 2,
  },
  {
    id: "seed-3",
    variant: "sell",
    title_ar: "بيع 50 ألف اسيا بـ 47.5 ألف دينار",
    title_en: "Sell 50k Asiacell for 47.5k IQD",
    amount_display: "47,500",
    unit_ar: "دينار",
    unit_en: "IQD",
    sort_order: 3,
  },
  {
    id: "seed-4",
    variant: "buy",
    title_ar: "شراء 25 ألف اسيا بـ 24.25 ألف",
    title_en: "Buy 25k Asiacell for 24.25k IQD",
    amount_display: "25,000",
    unit_ar: "اسيا سيل",
    unit_en: "Asiacell",
    sort_order: 4,
  },
];

const defaultProfile: SiteProfile = {
  full_name: "",
  email: "user@example.com",
  phone: "",
};

const defaultManagedServices: ManagedService[] = [
  {
    id: "pubg-uc",
    titleAr: "شحن UC ببجي موبايل",
    titleEn: "PUBG Mobile UC",
    descriptionAr: "شحن UC فوري بأفضل الأسعار — أرسل معرّف اللاعب واختر الباقة.",
    descriptionEn: "Instant UC top-up at competitive rates — enter your Player ID and pick a pack.",
    coverImage: "/services/pubg-uc-cover.png",
    badgeAr: "الأكثر طلباً",
    badgeEn: "Popular",
    actionType: "pubg_uc",
    enabled: true,
    comingSoon: false,
    sortOrder: 1,
  },
];

const defaultManagedPubgPackages: ManagedPubgPackage[] = [
  { id: "uc-30", label: "30", totalUc: 30, priceIqd: 590, isMinimum: true, iconTier: 1, enabled: true, sortOrder: 1 },
  { id: "uc-60", label: "60", totalUc: 60, priceIqd: 1180, isMinimum: true, iconTier: 1, enabled: true, sortOrder: 2 },
  { id: "uc-120", label: "120", totalUc: 120, priceIqd: 2400, isMinimum: false, iconTier: 1, enabled: true, sortOrder: 3 },
  { id: "uc-180", label: "180", totalUc: 180, priceIqd: 3600, isMinimum: false, iconTier: 1, enabled: true, sortOrder: 4 },
  { id: "uc-325", label: "25 + 300", totalUc: 325, priceIqd: 5900, isMinimum: false, iconTier: 2, enabled: true, sortOrder: 5 },
  { id: "uc-336", label: "26 + 310", totalUc: 336, priceIqd: 6200, isMinimum: false, iconTier: 2, enabled: true, sortOrder: 6 },
  { id: "uc-660", label: "60 + 600", totalUc: 660, priceIqd: 11800, isMinimum: false, iconTier: 2, enabled: true, sortOrder: 7 },
  { id: "uc-688", label: "63 + 625", totalUc: 688, priceIqd: 12500, isMinimum: false, iconTier: 2, enabled: true, sortOrder: 8 },
  { id: "uc-1172", label: "107 + 1065", totalUc: 1172, priceIqd: 21300, isMinimum: false, iconTier: 2, enabled: true, sortOrder: 9 },
  { id: "uc-1800", label: "300 + 1500", totalUc: 1800, priceIqd: 29500, isMinimum: false, iconTier: 3, enabled: true, sortOrder: 10 },
  { id: "uc-3850", label: "850 + 3000", totalUc: 3850, priceIqd: 59000, isMinimum: false, iconTier: 3, enabled: true, sortOrder: 11 },
  { id: "uc-8100", label: "2100 + 6000", totalUc: 8100, priceIqd: 118000, isMinimum: false, iconTier: 3, enabled: true, sortOrder: 12 },
];

const defaultAppSettings: Record<string, string> = {
  maintenance_mode: "false",

  buy_coming_soon: "false",
  sell_coming_soon: "false",
  /** قديمة: تُستخدم للتوافق عند غياب المفتاحين _buy_ و _sell_ */
  method_zaincash_enabled: "true",
  method_superqi_enabled: "true",
  method_firstbank_enabled: "true",
  method_fastpay_enabled: "true",
  method_creditcard_enabled: "true",
  method_zaincash_buy_enabled: "true",
  method_zaincash_sell_enabled: "true",
  method_superqi_buy_enabled: "true",
  method_superqi_sell_enabled: "true",
  method_firstbank_buy_enabled: "true",
  method_firstbank_sell_enabled: "true",
  method_fastpay_buy_enabled: "true",
  method_fastpay_sell_enabled: "true",
  method_creditcard_buy_enabled: "true",
  /** روابط وعرض الأرقام في بطاقة الصفحة الرئيسية — يُعدّل من البوت */
  link_support: "https://t.me/sarafiq_support",
  hero_buy_amount_display: "100,000",
  hero_sell_amount_display: "95,000",
  services_section_title_ar: "الخدمات",
  services_section_title_en: "Services",
  services_section_subtitle_ar: "شحن ألعاب ومنتجات رقمية — بسرعة وأمان.",
  services_section_subtitle_en: "Top up games and digital products — fast and secure.",
  services_catalog_json: JSON.stringify(defaultManagedServices),
  pubg_uc_title_ar: "شحن UC — ببجي موبايل",
  pubg_uc_title_en: "PUBG Mobile UC",
  pubg_uc_subtitle_ar: "اختر الباقة، أدخل معرّف اللاعب، وادفع بالبطاقة البنكية.",
  pubg_uc_subtitle_en: "Choose a UC pack, enter your Player ID, and pay by bank card.",
  pubg_uc_packages_json: JSON.stringify(defaultManagedPubgPackages),
  /** JSON array: admin-defined buy payment wallets (method_key wallet_<id>) */
  buy_custom_wallets: "[]",
  /** JSON array: admin-defined sell receiving wallets (method_key sell_wallet_<id>) */
  sell_custom_wallets: "[]",
};

function isValidHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function normalizeWalletIconUrl(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s) return null;
  if (isValidHttpUrl(s)) return s;
  if (/^\/uploads\/buy-wallet-icons\/[a-z0-9][a-z0-9_-]{0,20}\.png$/i.test(s)) return s;
  if (/^\/uploads\/sell-wallet-icons\/[a-z0-9][a-z0-9_-]{0,20}\.png$/i.test(s)) return s;
  return null;
}

function normalizeServiceId(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 36);
}

function parseManagedServices(raw: string | undefined): ManagedService[] {
  if (!raw || !raw.trim()) return [...defaultManagedServices];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [...defaultManagedServices];
    const out: ManagedService[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < parsed.length; i += 1) {
      const row = parsed[i];
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const id = normalizeServiceId(String(r.id || ""));
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const sortOrder = Number(r.sort_order ?? r.sortOrder ?? i + 1);
      const coverRaw = String(r.cover_image ?? r.coverImage ?? "/services/pubg-uc-cover.png").trim();
      const coverImage = isValidHttpUrl(coverRaw) || coverRaw.startsWith("/") ? coverRaw : "/services/pubg-uc-cover.png";
      const actionRaw = String(r.action_type ?? r.actionType ?? "coming_soon").trim();
      out.push({
        id,
        titleAr: String(r.title_ar ?? r.titleAr ?? ""),
        titleEn: String(r.title_en ?? r.titleEn ?? ""),
        descriptionAr: String(r.description_ar ?? r.descriptionAr ?? ""),
        descriptionEn: String(r.description_en ?? r.descriptionEn ?? ""),
        coverImage,
        badgeAr: String(r.badge_ar ?? r.badgeAr ?? ""),
        badgeEn: String(r.badge_en ?? r.badgeEn ?? ""),
        actionType: actionRaw === "pubg_uc" ? "pubg_uc" : "coming_soon",
        enabled: r.enabled !== false,
        comingSoon: r.coming_soon === true || r.comingSoon === true,
        sortOrder: Number.isFinite(sortOrder) ? sortOrder : i + 1,
      });
    }
    return out.sort((a, b) => a.sortOrder - b.sortOrder);
  } catch {
    return [...defaultManagedServices];
  }
}

function parseManagedPubgPackages(raw: string | undefined): ManagedPubgPackage[] {
  if (!raw || !raw.trim()) return [...defaultManagedPubgPackages];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [...defaultManagedPubgPackages];
    const out: ManagedPubgPackage[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < parsed.length; i += 1) {
      const row = parsed[i];
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const id = normalizeServiceId(String(r.id || `pkg-${i + 1}`));
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const tierRaw = Number(r.icon_tier ?? r.iconTier ?? 1);
      const iconTier: 1 | 2 | 3 = tierRaw === 2 ? 2 : tierRaw === 3 ? 3 : 1;
      const sortOrder = Number(r.sort_order ?? r.sortOrder ?? i + 1);
      out.push({
        id,
        label: String(r.label ?? ""),
        totalUc: Math.max(0, Number(r.total_uc ?? r.totalUc ?? 0)),
        priceIqd: Math.max(0, Number(r.price_iqd ?? r.priceIqd ?? 0)),
        isMinimum: r.is_minimum === true || r.isMinimum === true,
        iconTier,
        enabled: r.enabled !== false,
        sortOrder: Number.isFinite(sortOrder) ? sortOrder : i + 1,
      });
    }
    return out.sort((a, b) => a.sortOrder - b.sortOrder);
  } catch {
    return [...defaultManagedPubgPackages];
  }
}

/** مفاتيح نصية يمكن ضبطها من البوت (لا تُمرّر إلى الواجهة كأنواع boolean) */
export const SITE_STRING_SETTING_KEYS = [
  "link_support",
  "hero_buy_amount_display",
  "hero_sell_amount_display",
  "services_section_title_ar",
  "services_section_title_en",
  "services_section_subtitle_ar",
  "services_section_subtitle_en",
  "services_catalog_json",
  "pubg_uc_title_ar",
  "pubg_uc_title_en",
  "pubg_uc_subtitle_ar",
  "pubg_uc_subtitle_en",
  "pubg_uc_packages_json",
] as const;

export type SiteContentPublic = {
  supportUrl: string;
  heroBuyAmountDisplay: string;
  heroSellAmountDisplay: string;
  servicesSectionTitleAr: string;
  servicesSectionTitleEn: string;
  servicesSectionSubtitleAr: string;
  servicesSectionSubtitleEn: string;
  servicesCatalog: ManagedService[];
  pubgUcTitleAr: string;
  pubgUcTitleEn: string;
  pubgUcSubtitleAr: string;
  pubgUcSubtitleEn: string;
  pubgPackages: ManagedPubgPackage[];
};

export async function getSiteContent(): Promise<SiteContentPublic> {
  const merged: Record<string, string> = { ...defaultAppSettings };
  const dbSettings: Record<string, string> = {};
  if (db) {
    const { data, error } = await db.from("settings").select("key, value");
    if (!error && data?.length) {
      for (const row of data as { key: string; value: string }[]) {
        if (row.key && typeof row.value === "string") {
          merged[row.key] = row.value;
          dbSettings[row.key] = row.value;
        }
      }
    }
  }
  const fileSettings = loadFileStore().app_settings;
  /** ملف محلي ← قاعدة البيانات تتفوّق (كي تُطبَّق تعديلات لوحة الإدارة فعلياً) */
  const final = { ...merged, ...fileSettings, ...dbSettings };
  const support = (final.link_support || defaultAppSettings.link_support).trim();
  return {
    supportUrl: isValidHttpUrl(support) ? support : defaultAppSettings.link_support,
    heroBuyAmountDisplay: (final.hero_buy_amount_display || defaultAppSettings.hero_buy_amount_display).trim(),
    heroSellAmountDisplay: (final.hero_sell_amount_display || defaultAppSettings.hero_sell_amount_display).trim(),
    servicesSectionTitleAr: (final.services_section_title_ar || defaultAppSettings.services_section_title_ar).trim(),
    servicesSectionTitleEn: (final.services_section_title_en || defaultAppSettings.services_section_title_en).trim(),
    servicesSectionSubtitleAr: (final.services_section_subtitle_ar || defaultAppSettings.services_section_subtitle_ar).trim(),
    servicesSectionSubtitleEn: (final.services_section_subtitle_en || defaultAppSettings.services_section_subtitle_en).trim(),
    servicesCatalog: parseManagedServices(final.services_catalog_json),
    pubgUcTitleAr: (final.pubg_uc_title_ar || defaultAppSettings.pubg_uc_title_ar).trim(),
    pubgUcTitleEn: (final.pubg_uc_title_en || defaultAppSettings.pubg_uc_title_en).trim(),
    pubgUcSubtitleAr: (final.pubg_uc_subtitle_ar || defaultAppSettings.pubg_uc_subtitle_ar).trim(),
    pubgUcSubtitleEn: (final.pubg_uc_subtitle_en || defaultAppSettings.pubg_uc_subtitle_en).trim(),
    pubgPackages: parseManagedPubgPackages(final.pubg_uc_packages_json),
  };
}

function parseCustomWalletListJson(raw: string | undefined): BuyCustomWallet[] {
  if (!raw || raw.trim() === "") return [];
  try {
    const j = JSON.parse(raw) as unknown;
    if (!Array.isArray(j)) return [];
    const out: BuyCustomWallet[] = [];
    for (const row of j) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const id = typeof r.id === "string" ? r.id.trim() : "";
      if (!/^[a-z0-9][a-z0-9_-]{0,20}$/.test(id)) continue;
      const name_ar = typeof r.name_ar === "string" ? r.name_ar.trim() : "";
      const name_en = typeof r.name_en === "string" ? r.name_en.trim() : "";
      const enabled = r.enabled !== false;
      if (!name_ar && !name_en) continue;
      out.push({
        id,
        name_ar: name_ar || name_en,
        name_en: name_en || name_ar,
        enabled,
        icon_url: normalizeWalletIconUrl(r.icon_url),
      });
    }
    return out;
  } catch {
    return [];
  }
}

function parseBuyCustomWallets(raw: string | undefined): BuyCustomWallet[] {
  return parseCustomWalletListJson(raw);
}

function parseSellCustomWallets(raw: string | undefined): SellCustomWallet[] {
  return parseCustomWalletListJson(raw);
}

export async function getBuyCustomWallets(): Promise<BuyCustomWallet[]> {
  const merged: Record<string, string> = { ...defaultAppSettings };
  if (db) {
    const { data, error } = await db.from("settings").select("key, value");
    if (!error && data?.length) {
      for (const row of data as { key: string; value: string }[]) {
        if (row.key && typeof row.value === "string") merged[row.key] = row.value;
      }
    }
  }
  const fileSettings = loadFileStore().app_settings;
  const final = { ...merged, ...fileSettings };
  return parseBuyCustomWallets(final.buy_custom_wallets);
}

function syncBuyWalletIconFiles(prev: BuyCustomWallet[], next: BuyCustomWallet[]): void {
  ensureBuyWalletIconsDir();
  const nextIds = new Set(next.map((n) => n.id));
  const localPathFor = (id: string) => buyWalletIconPublicPath(id);

  for (const p of prev) {
    if (!nextIds.has(p.id)) {
      try {
        if (fs.existsSync(buyWalletIconDiskPath(p.id))) fs.unlinkSync(buyWalletIconDiskPath(p.id));
      } catch {
        /* ignore */
      }
      continue;
    }
    const n = next.find((x) => x.id === p.id);
    if (!n) continue;
    const hadLocal = p.icon_url === localPathFor(p.id);
    const hasLocal = n.icon_url === localPathFor(n.id);
    if (hadLocal && !hasLocal) {
      try {
        if (fs.existsSync(buyWalletIconDiskPath(p.id))) fs.unlinkSync(buyWalletIconDiskPath(p.id));
      } catch {
        /* ignore */
      }
    }
  }
}

export async function setBuyCustomWallets(next: BuyCustomWallet[]): Promise<BuyCustomWallet[]> {
  const normalized: BuyCustomWallet[] = [];
  for (const w of next) {
    if (!/^[a-z0-9][a-z0-9_-]{0,20}$/.test(w.id)) {
      throw new Error("invalid wallet id (use lowercase letters, numbers, - or _)");
    }
    normalized.push({
      id: w.id,
      name_ar: w.name_ar,
      name_en: w.name_en,
      enabled: w.enabled !== false,
      icon_url: normalizeWalletIconUrl(w.icon_url),
    });
  }
  const prev = await getBuyCustomWallets();
  syncBuyWalletIconFiles(prev, normalized);
  const prevIds = new Set(prev.map((p) => p.id));
  const json = JSON.stringify(normalized);
  if (db) {
    const { error } = await db.from("settings").upsert({ key: "buy_custom_wallets", value: json }, { onConflict: "key" });
    if (error) console.error("setBuyCustomWallets db:", error);
  }
  const st = loadFileStore();
  st.app_settings = { ...st.app_settings, buy_custom_wallets: json };
  saveFileStore(st);
  for (const w of normalized) {
    if (!prevIds.has(w.id)) {
      await grantWalletPermissionToAllAgents(w.id);
    }
  }
  return getBuyCustomWallets();
}

export async function getSellCustomWallets(): Promise<SellCustomWallet[]> {
  const merged: Record<string, string> = { ...defaultAppSettings };
  if (db) {
    const { data, error } = await db.from("settings").select("key, value");
    if (!error && data?.length) {
      for (const row of data as { key: string; value: string }[]) {
        if (row.key && typeof row.value === "string") merged[row.key] = row.value;
      }
    }
  }
  const fileSettings = loadFileStore().app_settings;
  const final = { ...merged, ...fileSettings };
  return parseSellCustomWallets(final.sell_custom_wallets);
}

function syncSellWalletIconFiles(prev: SellCustomWallet[], next: SellCustomWallet[]): void {
  ensureSellWalletIconsDir();
  const nextIds = new Set(next.map((n) => n.id));
  const localPathFor = (id: string) => sellWalletIconPublicPath(id);

  for (const p of prev) {
    if (!nextIds.has(p.id)) {
      try {
        if (fs.existsSync(sellWalletIconDiskPath(p.id))) fs.unlinkSync(sellWalletIconDiskPath(p.id));
      } catch {
        /* ignore */
      }
      continue;
    }
    const n = next.find((x) => x.id === p.id);
    if (!n) continue;
    const hadLocal = p.icon_url === localPathFor(p.id);
    const hasLocal = n.icon_url === localPathFor(n.id);
    if (hadLocal && !hasLocal) {
      try {
        if (fs.existsSync(sellWalletIconDiskPath(p.id))) fs.unlinkSync(sellWalletIconDiskPath(p.id));
      } catch {
        /* ignore */
      }
    }
  }
}

export async function setSellCustomWallets(next: SellCustomWallet[]): Promise<SellCustomWallet[]> {
  const normalized: SellCustomWallet[] = [];
  for (const w of next) {
    if (!/^[a-z0-9][a-z0-9_-]{0,20}$/.test(w.id)) {
      throw new Error("invalid wallet id (use lowercase letters, numbers, - or _)");
    }
    normalized.push({
      id: w.id,
      name_ar: w.name_ar,
      name_en: w.name_en,
      enabled: w.enabled !== false,
      icon_url: normalizeWalletIconUrl(w.icon_url),
    });
  }
  const prev = await getSellCustomWallets();
  syncSellWalletIconFiles(prev, normalized);
  const prevIds = new Set(prev.map((p) => p.id));
  const json = JSON.stringify(normalized);
  if (db) {
    const { error } = await db.from("settings").upsert({ key: "sell_custom_wallets", value: json }, { onConflict: "key" });
    if (error) console.error("setSellCustomWallets db:", error);
  }
  const st = loadFileStore();
  st.app_settings = { ...st.app_settings, sell_custom_wallets: json };
  saveFileStore(st);
  for (const w of normalized) {
    if (!prevIds.has(w.id)) {
      await grantSellWalletPermissionToAllAgents(w.id);
    }
  }
  return getSellCustomWallets();
}

async function grantSellWalletPermissionToAllAgents(walletId: string): Promise<void> {
  const perm = `method_sell_wallet_${walletId}`;
  const agents = await listAgents();
  for (const a of agents) {
    await addAgentPermission(a.id, perm);
  }
}

export async function addAgentPermission(agentId: string, permission: string): Promise<void> {
  const st = loadFileStore();
  const ix = st.agents.findIndex((a) => a.id === agentId);
  if (ix === -1) return;
  const cur = st.agents[ix].permissions || [];
  if (cur.includes(permission)) return;
  st.agents[ix].permissions = [...cur, permission];
  if (db) await db.from("agents").update({ permissions: st.agents[ix].permissions }).eq("id", agentId);
  saveFileStore(st);
}

async function grantWalletPermissionToAllAgents(walletId: string): Promise<void> {
  const perm = `method_wallet_${walletId}`;
  const agents = await listAgents();
  for (const a of agents) {
    await addAgentPermission(a.id, perm);
  }
}

export async function setSiteStringSetting(key: string, value: string): Promise<void> {
  if (!SITE_STRING_SETTING_KEYS.includes(key as (typeof SITE_STRING_SETTING_KEYS)[number])) {
    throw new Error("invalid site string key");
  }
  const v = value.trim();
  if (key === "link_support" && !isValidHttpUrl(v)) {
    throw new Error("invalid support URL");
  }
  if (db) {
    const { error } = await db.from("settings").upsert({ key, value: v }, { onConflict: "key" });
    if (error) {
      console.error("setSiteStringSetting db:", error);
      throw error;
    }
  }
  const st = loadFileStore();
  st.app_settings = { ...st.app_settings, [key]: v };
  saveFileStore(st);
}

function getSupabase(): SupabaseClient | null {
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  
  if (!url || !key) {
    console.warn("⚠️  Supabase Config Missing: Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your environment.");
    return null;
  }

  if (!isValidHttpUrl(url)) {
    console.warn("⚠️  Supabase URL is invalid:", url);
    return null;
  }

  return createClient(url, key);
}

export const db = getSupabase();

// Log connection status
if (db) {
  console.log("✅ Supabase connected successfully");
} else {
  console.warn("⚠️ Supabase NOT connected - using file storage (data will be lost on redeploy)");
}

function loadFileStore(): FileStore {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      return {
        transactions: [],
        offers: [...defaultOffers],
        site_profile: { ...defaultProfile },
        app_settings: { ...defaultAppSettings },
        agents: [],
        agent_numbers: [],
        agent_payment_methods: [],
        admins: [],
        bot_users: [],
        push_tokens: [],
      };
    }
    const raw = fs.readFileSync(DATA_FILE, "utf-8");
    const parsed = JSON.parse(raw) as Partial<FileStore>;
    return {
      transactions: Array.isArray(parsed.transactions) ? parsed.transactions : [],
      offers: Array.isArray(parsed.offers) && parsed.offers.length ? parsed.offers : [...defaultOffers],
      site_profile: parsed.site_profile && typeof parsed.site_profile === "object"
        ? { ...defaultProfile, ...parsed.site_profile }
        : { ...defaultProfile },
      app_settings:
        parsed.app_settings && typeof parsed.app_settings === "object"
          ? { ...defaultAppSettings, ...parsed.app_settings }
          : { ...defaultAppSettings },
      agents: Array.isArray(parsed.agents)
        ? parsed.agents.map(a => ({
            ...a,
            permissions: Array.isArray(a.permissions)
              ? a.permissions
              : ['add_number', 'reset_balance', 'method_zaincash', 'method_superqi', 'method_firstbank', 'method_fastpay', 'method_creditcard'],
          }))
        : [],
      agent_numbers: Array.isArray(parsed.agent_numbers) ? parsed.agent_numbers : [],
      agent_payment_methods: Array.isArray(parsed.agent_payment_methods) ? parsed.agent_payment_methods : [],
      admins: Array.isArray(parsed.admins)
        ? parsed.admins.map((a) => ({ ...a, email: typeof a.email === "string" ? a.email : null }))
        : [],
      bot_users: Array.isArray(parsed.bot_users) ? parsed.bot_users : [],
      push_tokens: Array.isArray(parsed.push_tokens) ? parsed.push_tokens : [],
    };
  } catch {
    return {
      transactions: [],
      offers: [...defaultOffers],
      site_profile: { ...defaultProfile },
      app_settings: { ...defaultAppSettings },
      agents: [],
      agent_numbers: [],
      agent_payment_methods: [],
      admins: [],
      bot_users: [],
      push_tokens: [],
    };
  }
}

function saveFileStore(store: FileStore) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), "utf-8");
  } catch (e) {
    console.error("saveFileStore:", e);
  }
}

function genOrderRef(): string {
  return `ORD-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
}

export async function listTransactionsByClient(clientId: string): Promise<ServerTransaction[]> {
  const fromFile = loadFileStore().transactions
    .filter((t) => t.client_id === clientId)
    .map((t) => normalizeTx(t));
  const map = new Map<string, ServerTransaction>();
  for (const t of fromFile) map.set(t.id, t);

  if (db) {
    const { data, error } = await db
      .from("transactions")
      .select("*")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) console.error("listTransactionsByClient:", error);
    else if (data?.length) {
      for (const row of data) {
        const tx = rowToTx(row as Record<string, unknown>);
        map.set(tx.id, tx);
      }
    }
  }

  return Array.from(map.values()).sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}

function rowToTx(row: Record<string, unknown>): ServerTransaction {
  const parsed = parseTxDetails(row.details != null ? String(row.details) : null);
  const rawType = String(row.type ?? "");
  return {
    id: String(row.id),
    order_ref: String(row.order_ref ?? ""),
    client_id: String(row.client_id ?? ""),
    user_id: row.user_id != null ? String(row.user_id) : null,
    user_name: (typeof row.user_name === "string" ? row.user_name : parsed.user_name) ?? null,
    user_ip: (typeof row.user_ip === "string" ? row.user_ip : parsed.user_ip) ?? null,
    type: rawType === "buy" || rawType === "deposit" ? rawType : "sell",
    amount: Number(row.amount),
    method: String(row.method ?? ""),
    status: String(row.status ?? "pending"),
    created_at:
      typeof row.created_at === "string"
        ? row.created_at
        : new Date(row.created_at as string).toISOString(),
    details: parsed.cleanDetails,
    agent_number_id: row.agent_number_id != null ? String(row.agent_number_id) : null,
    payment_proof: row.payment_proof != null ? String(row.payment_proof) : null,
  };
}

export async function createTransaction(input: {
  client_id: string;
  user_id?: string;
  user_name?: string;
  user_ip?: string;
  type: "buy" | "sell" | "deposit";
  amount: number;
  method: string;
  details?: string;
  agent_number_id?: string;
  payment_proof?: string | null;
}): Promise<ServerTransaction> {
  const order_ref = genOrderRef();
  const id = globalThis.crypto?.randomUUID?.() ?? `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const created_at = new Date().toISOString();
  const row: ServerTransaction = {
    id,
    order_ref,
    client_id: input.client_id,
    user_id: input.user_id ?? null,
    user_name: input.user_name?.trim() || null,
    user_ip: input.user_ip?.trim() || null,
    type: input.type,
    amount: input.amount,
    method: input.method,
    status: "pending",
    created_at,
    details: input.details ?? null,
    agent_number_id: input.agent_number_id ?? null,
    payment_proof: input.payment_proof ?? null,
  };
  const persistedDetails = encodeTxDetails(input.details, {
    user_name: input.user_name,
    user_ip: input.user_ip,
  });

  if (db) {
    const { data, error } = await db
      .from("transactions")
      .insert([
        {
          id,
          order_ref,
          client_id: input.client_id,
          user_id: input.user_id ?? null,
          type: input.type,
          amount: input.amount,
          method: input.method,
          status: "pending",
          details: persistedDetails,
          agent_number_id: input.agent_number_id ?? null,
          payment_proof: input.payment_proof ?? null,
        },
      ])
      .select()
      .single();
    if (!error && data) {
      return rowToTx(data as Record<string, unknown>);
    }
    console.error("createTransaction db (using file fallback):", error);
  }

  const store = loadFileStore();
  store.transactions.unshift({
    ...row,
    details: persistedDetails,
  });
  saveFileStore(store);
  return normalizeTx(row);
}

/** جميع الطلبات (ملف + قاعدة) لإحصاءات البوت ولوحة التحكم */
export async function listAllTransactionsMerged(): Promise<ServerTransaction[]> {
  const map = new Map<string, ServerTransaction>();

  if (db) {
    const { data, error } = await db
      .from("transactions")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(5000);

    if (!error && data?.length) {
      for (const row of data) {
        const tx = rowToTx(row as Record<string, unknown>);
        map.set(tx.id, tx);
      }
    }
  }

  for (const t of loadFileStore().transactions.map((x) => normalizeTx(x))) {
    if (!map.has(t.id)) {
      map.set(t.id, t);
    }
  }

  return Array.from(map.values()).sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}

export async function getTransactionStatusCounts(): Promise<{
  pending: number;
  completed: number;
  failed: number;
}> {
  const all = await listAllTransactionsMerged();
  return {
    pending: all.filter((t) => t.status === "pending").length,
    completed: all.filter((t) => t.status === "completed").length,
    failed: all.filter((t) => t.status === "failed").length,
  };
}

export async function listTransactionsByStatusMerged(
  status: "pending" | "completed" | "failed",
  limit = 15
): Promise<ServerTransaction[]> {
  const all = await listAllTransactionsMerged();
  return all.filter((t) => t.status === status).slice(0, limit);
}

export async function updateTransactionStatusByRef(
  orderRef: string,
  status: string
): Promise<boolean> {
  const before = await getTransactionByOrderRef(orderRef);
  if (
    before?.user_id &&
    before.type === "buy" &&
    before.status !== "completed" &&
    status === "completed"
  ) {
    const balance = await getUserBalance(before.user_id);
    if (balance < before.amount) return false;
  }
  let ok = false;
  if (db) {
    const { error } = await db.from("transactions").update({ status }).eq("order_ref", orderRef);
    if (!error) ok = true;
    else console.error("updateTransactionStatusByRef db:", error);
  }
  const store = loadFileStore();
  const ix = store.transactions.findIndex((t) => t.order_ref === orderRef);
  if (ix !== -1) {
    store.transactions[ix] = { ...store.transactions[ix], status };
    saveFileStore(store);
    ok = true;
  }
  if (ok && before?.user_id) {
    const delta = balanceDeltaForStatusChange(before.type, before.amount, before.status, status);
    if (delta !== 0) {
      await adjustUserBalance(before.user_id, delta);
    }
  }
  return ok;
}

function balanceDeltaByStatus(type: ServerTransaction["type"], amount: number, status: string): number {
  if (status !== "completed") return 0;
  if (type === "deposit") return amount;
  if (type === "buy") return -amount;
  return 0;
}

function balanceDeltaForStatusChange(
  type: ServerTransaction["type"],
  amount: number,
  oldStatus: string,
  newStatus: string
): number {
  return balanceDeltaByStatus(type, amount, newStatus) - balanceDeltaByStatus(type, amount, oldStatus);
}

async function getTransactionByOrderRef(orderRef: string): Promise<ServerTransaction | null> {
  if (db) {
    const { data, error } = await db.from("transactions").select("*").eq("order_ref", orderRef).maybeSingle();
    if (!error && data) return rowToTx(data as Record<string, unknown>);
  }
  const local = loadFileStore().transactions.find((x) => x.order_ref === orderRef);
  return local ? normalizeTx(local) : null;
}

export async function getUserBalance(userId: string): Promise<number> {
  if (!userId.trim()) return 0;
  if (db) {
    const { data, error } = await db.from("profiles").select("balance").eq("id", userId).maybeSingle();
    if (!error && data) {
      return Number((data as { balance?: number }).balance ?? 0);
    }
  }
  return 0;
}

export async function adjustUserBalance(userId: string, delta: number): Promise<number> {
  if (!userId.trim() || delta === 0) return getUserBalance(userId);
  if (db) {
    const current = await getUserBalance(userId);
    const next = Math.max(0, current + delta);
    const { error } = await db.from("profiles").update({ balance: next }).eq("id", userId);
    if (error) {
      console.error("adjustUserBalance:", error);
      return current;
    }
    return next;
  }
  return 0;
}

export async function listOffers(): Promise<ServerOffer[]> {
  if (db) {
    const { data, error } = await db
      .from("offers")
      .select("*")
      .order("sort_order", { ascending: true });
    
    if (error) {
      console.error("listOffers db error:", error);
    } else if (data && data.length > 0) {
      return data.map((r: Record<string, unknown>) => ({
        id: String(r.id),
        variant: r.variant === "buy" ? "buy" : "sell",
        title_ar: String(r.title_ar ?? ""),
        title_en: String(r.title_en ?? ""),
        amount_display: String(r.amount_display ?? ""),
        unit_ar: String(r.unit_ar ?? ""),
        unit_en: String(r.unit_en ?? ""),
        sort_order: Number(r.sort_order ?? 0),
      }));
    }
  }
  return loadFileStore().offers.sort((a, b) => a.sort_order - b.sort_order);
}

export async function getSiteProfile(): Promise<SiteProfile> {
  if (db) {
    const { data, error } = await db.from("site_profile").select("*").eq("id", 1).maybeSingle();
    if (error) {
      console.error("getSiteProfile:", error);
      return { ...defaultProfile };
    }
    if (!data) return { ...defaultProfile };
    const r = data as Record<string, unknown>;
    return {
      full_name: String(r.full_name ?? defaultProfile.full_name),
      email: String(r.email ?? defaultProfile.email),
      phone: String(r.phone ?? ""),
    };
  }
  return { ...loadFileStore().site_profile };
}

export async function updateSiteProfile(patch: Partial<SiteProfile>): Promise<SiteProfile> {
  const current = await getSiteProfile();
  const next: SiteProfile = {
    full_name: patch.full_name ?? current.full_name,
    email: patch.email ?? current.email,
    phone: patch.phone ?? current.phone,
  };

  if (db) {
    const { error } = await db.from("site_profile").upsert(
      { id: 1, ...next, updated_at: new Date().toISOString() },
      { onConflict: "id" }
    );
    if (error) console.error("updateSiteProfile db:", error);
  }
  const store = loadFileStore();
  store.site_profile = next;
  saveFileStore(store);
  return next;
}

export type AppSettingsPublic = {
  maintenance_mode: boolean;
  buy_coming_soon: boolean;
  sell_coming_soon: boolean;
  method_zaincash_buy_enabled: boolean;
  method_zaincash_sell_enabled: boolean;
  method_superqi_buy_enabled: boolean;
  method_superqi_sell_enabled: boolean;
  method_firstbank_buy_enabled: boolean;
  method_firstbank_sell_enabled: boolean;
  method_fastpay_buy_enabled: boolean;
  method_fastpay_sell_enabled: boolean;
  method_creditcard_buy_enabled: boolean;
  buy_custom_wallets: BuyCustomWallet[];
  sell_custom_wallets: SellCustomWallet[];
};

function methodPairFromMerged(
  merged: Record<string, string>,
  base: "zaincash" | "superqi" | "firstbank" | "fastpay"
): { buy: boolean; sell: boolean } {
  const legacyKey = `method_${base}_enabled`;
  const legacyVal = merged[legacyKey] === undefined ? true : merged[legacyKey] !== "false";
  const buyKey = `method_${base}_buy_enabled`;
  const sellKey = `method_${base}_sell_enabled`;
  const buy = merged[buyKey] === undefined ? legacyVal : merged[buyKey] !== "false";
  const sell = merged[sellKey] === undefined ? legacyVal : merged[sellKey] !== "false";
  return { buy, sell };
}

function creditcardBuyFromMerged(merged: Record<string, string>): boolean {
  const legacyVal =
    merged.method_creditcard_enabled === undefined ? true : merged.method_creditcard_enabled !== "false";
  return merged.method_creditcard_buy_enabled === undefined
    ? legacyVal
    : merged.method_creditcard_buy_enabled !== "false";
}

const APP_SETTING_KEYS = [
  "maintenance_mode",
  "buy_coming_soon",
  "sell_coming_soon",
  "method_zaincash_buy_enabled",
  "method_zaincash_sell_enabled",
  "method_superqi_buy_enabled",
  "method_superqi_sell_enabled",
  "method_firstbank_buy_enabled",
  "method_firstbank_sell_enabled",
  "method_fastpay_buy_enabled",
  "method_fastpay_sell_enabled",
  "method_creditcard_buy_enabled",
] as const;

export async function getAppSettings(): Promise<AppSettingsPublic> {
  const merged: Record<string, string> = { ...defaultAppSettings };
  
  if (db) {
    const { data, error } = await db.from("settings").select("key, value");
    if (!error && data?.length) {
      for (const row of data as { key: string; value: string }[]) {
        if (row.key && typeof row.value === "string") merged[row.key] = row.value;
      }
      const z = methodPairFromMerged(merged, "zaincash");
      const su = methodPairFromMerged(merged, "superqi");
      const fi = methodPairFromMerged(merged, "firstbank");
      const fa = methodPairFromMerged(merged, "fastpay");
      return {
        maintenance_mode: merged.maintenance_mode === "true",
        buy_coming_soon: merged.buy_coming_soon === "true",
        sell_coming_soon: merged.sell_coming_soon === "true",
        method_zaincash_buy_enabled: z.buy,
        method_zaincash_sell_enabled: z.sell,
        method_superqi_buy_enabled: su.buy,
        method_superqi_sell_enabled: su.sell,
        method_firstbank_buy_enabled: fi.buy,
        method_firstbank_sell_enabled: fi.sell,
        method_fastpay_buy_enabled: fa.buy,
        method_fastpay_sell_enabled: fa.sell,
        method_creditcard_buy_enabled: creditcardBuyFromMerged(merged),
        buy_custom_wallets: parseBuyCustomWallets(merged.buy_custom_wallets),
        sell_custom_wallets: parseSellCustomWallets(merged.sell_custom_wallets),
      };
    }
  }

  // Fallback to local file settings
  const fileSettings = loadFileStore().app_settings;
  const final = { ...merged, ...fileSettings };
  const z = methodPairFromMerged(final, "zaincash");
  const su = methodPairFromMerged(final, "superqi");
  const fi = methodPairFromMerged(final, "firstbank");
  const fa = methodPairFromMerged(final, "fastpay");
  return {
    maintenance_mode: final.maintenance_mode === "true",
    buy_coming_soon: final.buy_coming_soon === "true",
    sell_coming_soon: final.sell_coming_soon === "true",
    method_zaincash_buy_enabled: z.buy,
    method_zaincash_sell_enabled: z.sell,
    method_superqi_buy_enabled: su.buy,
    method_superqi_sell_enabled: su.sell,
    method_firstbank_buy_enabled: fi.buy,
    method_firstbank_sell_enabled: fi.sell,
    method_fastpay_buy_enabled: fa.buy,
    method_fastpay_sell_enabled: fa.sell,
    method_creditcard_buy_enabled: creditcardBuyFromMerged(final),
    buy_custom_wallets: parseBuyCustomWallets(final.buy_custom_wallets),
    sell_custom_wallets: parseSellCustomWallets(final.sell_custom_wallets),
  };
}

export async function setAppSetting(key: string, value: boolean): Promise<AppSettingsPublic> {
  if (!APP_SETTING_KEYS.includes(key as (typeof APP_SETTING_KEYS)[number])) {
    throw new Error("invalid setting key");
  }
  const str = value ? "true" : "false";
  if (db) {
    const { error } = await db.from("settings").upsert({ key, value: str }, { onConflict: "key" });
    if (error) console.error("setAppSetting db:", error);
  }
  const st = loadFileStore();
  st.app_settings = { ...st.app_settings, [key]: str };
  saveFileStore(st);
  return getAppSettings();
}

/** AGENTS MANAGEMENT */

export async function listAgents(): Promise<Agent[]> {
  if (db) {
    const { data, error } = await db.from("agents").select("*").order("created_at", { ascending: false });
    if (error) {
      console.error("listAgents:", error);
    } else {
      return (data ?? []) as Agent[];
    }
  }
  return loadFileStore().agents;
}

export async function createAgent(input: { telegram_id: number; name: string }): Promise<Agent> {
  const id = globalThis.crypto?.randomUUID?.() ?? `agent-${Date.now()}`;
  const row: Agent = {
    id,
    telegram_id: input.telegram_id,
    name: input.name,
    is_active: false,
    permissions: ['add_number', 'reset_balance', 'method_zaincash', 'method_superqi', 'method_firstbank', 'method_fastpay', 'method_creditcard'],
    created_at: new Date().toISOString(),
  };
  if (db) {
    await db.from("agents").insert([row]);
  }
  const st = loadFileStore();
  st.agents.unshift(row);
  saveFileStore(st);
  const wallets = await getBuyCustomWallets();
  for (const w of wallets) {
    await addAgentPermission(id, `method_wallet_${w.id}`);
  }
  const sellWallets = await getSellCustomWallets();
  for (const w of sellWallets) {
    await addAgentPermission(id, `method_sell_wallet_${w.id}`);
  }
  return row;
}

export async function toggleAgentActive(id: string, active: boolean): Promise<void> {
  if (db) {
    if (active) {
      await db.from("agents").update({ is_active: false }).neq("id", id);
    }
    await db.from("agents").update({ is_active: active }).eq("id", id);
  }
  const st = loadFileStore();
  if (active) {
    for (let i = 0; i < st.agents.length; i++) {
      if (st.agents[i].id !== id) st.agents[i].is_active = false;
    }
  }
  const ix = st.agents.findIndex(a => a.id === id);
  if (ix !== -1) {
    st.agents[ix].is_active = active;
    saveFileStore(st);
  }
}

export async function deleteAgent(id: string): Promise<void> {
  if (db) {
    await db.from("agents").delete().eq("id", id);
    await db.from("agent_numbers").delete().eq("agent_id", id);
    await db.from("agent_payment_methods").delete().eq("agent_id", id);
  }
  const st = loadFileStore();
  st.agents = st.agents.filter(a => a.id !== id);
  st.agent_numbers = st.agent_numbers.filter(n => n.agent_id !== id);
  st.agent_payment_methods = st.agent_payment_methods.filter((m) => m.agent_id !== id);
  saveFileStore(st);
}

/** AGENT NUMBERS */

export async function listAgentNumbers(agentId?: string): Promise<AgentNumber[]> {
  if (db) {
    let query = db.from("agent_numbers").select("*").order("sort_order", { ascending: true });
    if (agentId) query = query.eq("agent_id", agentId);
    const { data, error } = await query;
    if (error) {
      console.error("listAgentNumbers:", error);
    } else {
      return (data ?? []) as AgentNumber[];
    }
  }
  const nums = loadFileStore().agent_numbers;
  return agentId ? nums.filter(n => n.agent_id === agentId).sort((a,b) => a.sort_order - b.sort_order) : nums;
}

export async function getAgentNumberById(id: string): Promise<AgentNumber | null> {
  if (db) {
    const { data, error } = await db.from("agent_numbers").select("*").eq("id", id).maybeSingle();
    if (!error && data) return data as AgentNumber;
  }
  return loadFileStore().agent_numbers.find((n) => n.id === id) ?? null;
}

export async function addAgentNumber(agentId: string, phoneNumber: string, sortOrder: number): Promise<AgentNumber> {
  const id = globalThis.crypto?.randomUUID?.() ?? `num-${Date.now()}`;
  const row: AgentNumber = {
    id,
    agent_id: agentId,
    phone_number: phoneNumber,
    balance: 0,
    is_exhausted: false,
    sort_order: sortOrder,
  };
  if (db) {
    await db.from("agent_numbers").insert([row]);
  }
  const st = loadFileStore();
  st.agent_numbers.push(row);
  saveFileStore(st);
  return row;
}

export async function updateAgentNumber(id: string, patch: Partial<AgentNumber>): Promise<void> {
  if (db) {
    await db.from("agent_numbers").update(patch).eq("id", id);
  }
  const st = loadFileStore();
  const ix = st.agent_numbers.findIndex(n => n.id === id);
  if (ix !== -1) {
    st.agent_numbers[ix] = { ...st.agent_numbers[ix], ...patch };
    saveFileStore(st);
  }
}

export async function deleteAgentNumber(id: string): Promise<void> {
  if (db) {
    await db.from("agent_numbers").delete().eq("id", id);
  }
  const st = loadFileStore();
  st.agent_numbers = st.agent_numbers.filter(n => n.id !== id);
  saveFileStore(st);
}

/** AGENT PAYMENT METHODS (per-agent receiving accounts) */
const AGENT_METHOD_KEYS: AgentPaymentMethodKey[] = ["zaincash", "superqi", "firstbank", "fastpay"];

/** Accepts built-in keys + admin wallets <code>wallet_*</code> / <code>sell_wallet_*</code> */
export function normalizeAgentPaymentMethodKey(input: string): string | null {
  const s = input.trim().toLowerCase();
  if (/^wallet_[a-z0-9][a-z0-9_-]{0,20}$/.test(s)) return s;
  if (/^sell_wallet_[a-z0-9][a-z0-9_-]{0,20}$/.test(s)) return s;
  if (s === "fib" || s === "fip" || s === "firstbank") return "firstbank";
  if (s === "zaincash") return "zaincash";
  if (s === "superqi") return "superqi";
  if (s === "fastpay") return "fastpay";
  return null;
}

export async function upsertAgentPaymentMethod(input: {
  agent_id: string;
  method_key: string;
  account_number: string;
  account_holder?: string | null;
  barcode_url?: string | null;
}): Promise<AgentPaymentMethod | null> {
  const key = normalizeAgentPaymentMethodKey(input.method_key);
  const agentId = input.agent_id.trim();
  const number = input.account_number.trim();
  if (!key || !agentId || !number) return null;
  const row: AgentPaymentMethod = {
    id: globalThis.crypto?.randomUUID?.() ?? `apm-${Date.now()}`,
    agent_id: agentId,
    method_key: key,
    account_number: number,
    account_holder: input.account_holder?.trim() ? input.account_holder.trim() : null,
    barcode_url: input.barcode_url?.trim() ? input.barcode_url.trim() : null,
    updated_at: new Date().toISOString(),
  };

  if (db) {
    const { error } = await db.from("agent_payment_methods").upsert(
      {
        agent_id: row.agent_id,
        method_key: row.method_key,
        account_number: row.account_number,
        account_holder: row.account_holder,
        barcode_url: row.barcode_url,
        updated_at: row.updated_at,
      },
      { onConflict: "agent_id,method_key" },
    );
    if (error) console.error("upsertAgentPaymentMethod:", error);
  }

  const st = loadFileStore();
  const ix = st.agent_payment_methods.findIndex(
    (m) => m.agent_id === row.agent_id && m.method_key === row.method_key,
  );
  if (ix === -1) st.agent_payment_methods.push(row);
  else st.agent_payment_methods[ix] = { ...st.agent_payment_methods[ix], ...row };
  saveFileStore(st);
  return row;
}

export async function listAgentPaymentMethods(agentId: string): Promise<AgentPaymentMethod[]> {
  const id = agentId.trim();
  if (!id) return [];
  if (db) {
    const { data, error } = await db
      .from("agent_payment_methods")
      .select("*")
      .eq("agent_id", id);
    if (error) {
      console.error("listAgentPaymentMethods:", error);
    } else {
      return ((data ?? []) as AgentPaymentMethod[]).sort((a, b) => {
        const ai = AGENT_METHOD_KEYS.indexOf(a.method_key as AgentPaymentMethodKey);
        const bi = AGENT_METHOD_KEYS.indexOf(b.method_key as AgentPaymentMethodKey);
        if (ai !== -1 && bi !== -1) return ai - bi;
        if (ai !== -1) return -1;
        if (bi !== -1) return 1;
        return a.method_key.localeCompare(b.method_key);
      });
    }
  }
  return loadFileStore().agent_payment_methods
    .filter((m) => m.agent_id === id)
    .sort((a, b) => {
      const ai = AGENT_METHOD_KEYS.indexOf(a.method_key as AgentPaymentMethodKey);
      const bi = AGENT_METHOD_KEYS.indexOf(b.method_key as AgentPaymentMethodKey);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      return a.method_key.localeCompare(b.method_key);
    });
}

export async function removeAgentPaymentMethod(agentId: string, methodKey: string): Promise<void> {
  const id = agentId.trim();
  const key = normalizeAgentPaymentMethodKey(methodKey);
  if (!id || !key) return;
  if (db) {
    const { error } = await db
      .from("agent_payment_methods")
      .delete()
      .eq("agent_id", id)
      .eq("method_key", key);
    if (error) console.error("removeAgentPaymentMethod:", error);
  }
  const st = loadFileStore();
  st.agent_payment_methods = st.agent_payment_methods.filter(
    (m) => !(m.agent_id === id && m.method_key === key),
  );
  saveFileStore(st);
}

/** ACTIVE NUMBER LOGIC */

export async function getActiveSellNumber(): Promise<{
  /** رقم اسيا للتحويل عند البيع — قد يكون null إن لم يبقَ رقم متاحاً رغم تفعيل الوكيل */
  phoneNumber: string | null;
  agentId: string;
  numberId: string | null;
  allowedMethods: Record<string, boolean>;
  paymentMethods: Array<{
    method_key: string;
    account_number: string;
    account_holder: string | null;
    barcode_url: string | null;
  }>;
} | null> {
  const agents = await listAgents();
  const activeAgent = agents.find(a => a.is_active);
  if (!activeAgent) return null;

  const numbers = await listAgentNumbers(activeAgent.id);
  const activeNum = numbers.find(n => !n.is_exhausted && n.balance < 300000);

  const perms = new Set(activeAgent.permissions || []);
  const hasMethodPerms = [...perms].some((p) => p.startsWith("method_"));
  const allowedMethods: Record<string, boolean> = {
    zaincash: hasMethodPerms ? perms.has("method_zaincash") : true,
    superqi: hasMethodPerms ? perms.has("method_superqi") : true,
    firstbank: hasMethodPerms ? perms.has("method_firstbank") : true,
    fastpay: hasMethodPerms ? perms.has("method_fastpay") : true,
    creditcard: hasMethodPerms ? perms.has("method_creditcard") : true,
  };
  const customWallets = await getBuyCustomWallets();
  for (const w of customWallets) {
    if (!w.enabled) continue;
    const mid = `wallet_${w.id}`;
    const pkey = `method_wallet_${w.id}`;
    allowedMethods[mid] = hasMethodPerms ? perms.has(pkey) : true;
  }
  const sellCustomWallets = await getSellCustomWallets();
  for (const w of sellCustomWallets) {
    if (!w.enabled) continue;
    const mid = `sell_wallet_${w.id}`;
    const pkey = `method_sell_wallet_${w.id}`;
    allowedMethods[mid] = hasMethodPerms ? perms.has(pkey) : true;
  }
  const paymentMethodsRaw = await listAgentPaymentMethods(activeAgent.id);
  const paymentMethods = paymentMethodsRaw
    .filter((m) => String(m.account_number ?? "").trim().length > 0)
    .map((m) => {
      const nk =
        normalizeAgentPaymentMethodKey(m.method_key) ??
        m.method_key.trim().toLowerCase();
      return {
        method_key: nk,
        account_number: String(m.account_number).trim(),
        account_holder: m.account_holder ?? null,
        barcode_url: m.barcode_url ?? null,
      };
    });

  return {
    phoneNumber: activeNum ? activeNum.phone_number : null,
    agentId: activeAgent.id,
    numberId: activeNum ? activeNum.id : null,
    allowedMethods,
    paymentMethods,
  };
}

export async function incrementNumberBalance(numberId: string, amount: number): Promise<{ exhausted: boolean; agentId: string } | null> {
  const st = loadFileStore();
  const ix = st.agent_numbers.findIndex(n => n.id === numberId);
  if (ix === -1) return null;

  const newBalance = st.agent_numbers[ix].balance + amount;
  const exhausted = newBalance >= 300000;
  
  const update = { balance: newBalance, is_exhausted: exhausted };
  
  if (db) {
    await db.from("agent_numbers").update(update).eq("id", numberId);
  }
  
  st.agent_numbers[ix] = { ...st.agent_numbers[ix], ...update };
  saveFileStore(st);
  
  return { exhausted, agentId: st.agent_numbers[ix].agent_id };
}

/** PERMISSIONS & ADMINS */

export async function toggleAgentPermission(agentId: string, permission: string): Promise<void> {
  const st = loadFileStore();
  const ix = st.agents.findIndex(a => a.id === agentId);
  if (ix === -1) return;
  const current = st.agents[ix].permissions || [];
  if (current.includes(permission)) {
    st.agents[ix].permissions = current.filter(p => p !== permission);
  } else {
    st.agents[ix].permissions = [...current, permission];
  }
  if (db) await db.from("agents").update({ permissions: st.agents[ix].permissions }).eq("id", agentId);
  saveFileStore(st);
}

export async function listAdmins(): Promise<Admin[]> {
  if (db) {
    const { data, error } = await db.from("admins").select("*").order("created_at", { ascending: false });
    if (!error && data?.length) {
      return (data as Admin[]).map((a) => ({ ...a, email: typeof a.email === "string" ? a.email : null }));
    }
  }
  return loadFileStore().admins;
}

export async function createAdmin(input: { telegram_id: number; name: string; email?: string | null }): Promise<Admin> {
  const id = globalThis.crypto?.randomUUID?.() ?? `admin-${Date.now()}`;
  const row: Admin = {
    id,
    telegram_id: input.telegram_id,
    name: input.name,
    email: input.email?.trim() || null,
    permissions: ['manage_agents', 'site_settings', 'edit_links', 'view_stats'], // Default
    created_at: new Date().toISOString(),
  };
  if (db) {
    const { error } = await db.from("admins").insert([row]);
    if (error) {
      // توافق مع مخطط قديم لا يحتوي عمود email
      const { error: e2 } = await db.from("admins").insert([
        {
          id: row.id,
          telegram_id: row.telegram_id,
          name: row.name,
          permissions: row.permissions,
          created_at: row.created_at,
        },
      ]);
      if (e2) console.error("createAdmin:", e2);
    }
  }
  const st = loadFileStore();
  st.admins.unshift(row);
  saveFileStore(st);
  return row;
}

export async function updateAdmin(adminId: string, patch: Partial<Pick<Admin, "name" | "email">>): Promise<void> {
  const next: Record<string, string | null> = {};
  if (typeof patch.name === "string") next.name = patch.name.trim();
  if (typeof patch.email === "string") next.email = patch.email.trim() || null;
  else if (patch.email === null) next.email = null;
  if (Object.keys(next).length === 0) return;

  if (db) {
    const { error } = await db.from("admins").update(next).eq("id", adminId);
    if (error) console.error("updateAdmin:", error);
  }
  const st = loadFileStore();
  const ix = st.admins.findIndex((a) => a.id === adminId);
  if (ix !== -1) {
    st.admins[ix] = { ...st.admins[ix], ...next } as Admin;
    saveFileStore(st);
  }
}

export async function toggleAdminPermission(adminId: string, permission: string): Promise<void> {
  const st = loadFileStore();
  const ix = st.admins.findIndex(a => a.id === adminId);
  if (ix === -1) return;
  const current = st.admins[ix].permissions || [];
  if (current.includes(permission)) {
    st.admins[ix].permissions = current.filter(p => p !== permission);
  } else {
    st.admins[ix].permissions = [...current, permission];
  }
  if (db) await db.from("admins").update({ permissions: st.admins[ix].permissions }).eq("id", adminId);
  saveFileStore(st);
}

export async function deleteAdmin(id: string): Promise<void> {
  const st = loadFileStore();
  const admin = st.admins.find(a => a.id === id);
  
  // Safety: Cannot delete Super Admin from the list if they were added
  if (admin && admin.telegram_id.toString() === process.env.TELEGRAM_CHAT_ID) {
    return;
  }

  if (db) await db.from("admins").delete().eq("id", id);
  st.admins = st.admins.filter(a => a.id !== id);
  saveFileStore(st);
}

/**
 * Bot Users Management (for Broadcasts)
 */
export async function registerBotUser(telegramId: number) {
  // Always check DB first as the primary truth
  if (db) {
    const { data, error } = await db.from("bot_users").select("*").eq("telegram_id", telegramId).maybeSingle();
    if (!error && data) return data as BotUser;
  }

  const store = loadFileStore();
  const exists = store.bot_users.find((u) => u.telegram_id === telegramId);
  if (exists) return exists;

  const newUser: BotUser = {
    id: globalThis.crypto?.randomUUID?.() ?? `botuser-${Date.now()}`,
    telegram_id: telegramId,
    created_at: new Date().toISOString(),
  };

  if (db) {
    const { error } = await db.from("bot_users").upsert({
      telegram_id: telegramId,
      created_at: newUser.created_at,
    });
    if (error) console.error("registerBotUser DB failure:", error);
  }

  store.bot_users.push(newUser);
  saveFileStore(store);
  return newUser;
}

export async function listBotUsers() {
  if (db) {
    const { data, error } = await db.from("bot_users").select("*");
    if (!error && data) return data as BotUser[];
  }
  const store = loadFileStore();
  return store.bot_users;
}

/**
 * Offers Management
 */
export async function createOffer(offerData: Omit<ServerOffer, "id">) {
  const store = loadFileStore();
  const id = globalThis.crypto?.randomUUID?.() ?? `offer-${Date.now()}`;
  const newOffer: ServerOffer = {
    id,
    ...offerData,
  };
  store.offers.push(newOffer);
  store.offers.sort((a, b) => a.sort_order - b.sort_order);
  saveFileStore(store);

  if (db) {
    await db.from("offers").insert(newOffer);
  }
  return newOffer;
}

export async function deleteOffer(id: string) {
  if (db) {
    await db.from("offers").delete().eq("id", id);
  }
  const store = loadFileStore();
  store.offers = store.offers.filter((o) => o.id !== id);
  saveFileStore(store);
}

/** تسجيل رمز FCM للتطبيق (أندرويد/آيفون) */
export async function upsertPushToken(input: { token: string; client_id: string; platform: string }): Promise<void> {
  const updated_at = new Date().toISOString();
  const row: PushTokenRecord = { ...input, updated_at };
  if (db) {
    const { error } = await db.from("push_tokens").upsert(
      { token: input.token, client_id: input.client_id, platform: input.platform, updated_at },
      { onConflict: "token" }
    );
    if (error) console.error("upsertPushToken:", error);
  }
  const st = loadFileStore();
  const ix = st.push_tokens.findIndex((p) => p.token === input.token);
  if (ix === -1) st.push_tokens.push(row);
  else st.push_tokens[ix] = row;
  saveFileStore(st);
}

export async function listPushTokens(): Promise<PushTokenRecord[]> {
  if (db) {
    const { data, error } = await db.from("push_tokens").select("*");
    if (!error && data?.length) return data as PushTokenRecord[];
  }
  return loadFileStore().push_tokens;
}

export async function removePushTokens(tokens: string[]): Promise<void> {
  if (!tokens.length) return;
  if (db) {
    await db.from("push_tokens").delete().in("token", tokens);
  }
  const st = loadFileStore();
  const set = new Set(tokens);
  st.push_tokens = st.push_tokens.filter((p) => !set.has(p.token));
  saveFileStore(st);
}

/** إزالة كل رموز FCM المرتبطة بعميل (عند إطفاء الإشعارات من الإعدادات) */
export async function removePushTokensByClientId(client_id: string): Promise<void> {
  const id = client_id.trim();
  if (!id) return;
  if (db) {
    const { error } = await db.from("push_tokens").delete().eq("client_id", id);
    if (error) console.error("removePushTokensByClientId:", error);
  }
  const st = loadFileStore();
  st.push_tokens = st.push_tokens.filter((p) => p.client_id !== id);
  saveFileStore(st);
}
