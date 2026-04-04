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

type FileStore = {
  transactions: ServerTransaction[];
  offers: ServerOffer[];
  site_profile: SiteProfile;
  /** نفس مفاتيح جدول settings في Supabase: القيم 'true' | 'false' */
  app_settings: Record<string, string>;
};

const DATA_DIR = path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "saraf-store.json");

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
  full_name: "Business User",
  email: "user@example.com",
  phone: "",
};

const defaultAppSettings: Record<string, string> = {
  maintenance_mode: "false",
  buy_coming_soon: "false",
  sell_coming_soon: "false",
};

function isValidHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function getSupabase(): SupabaseClient | null {
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key || !isValidHttpUrl(url)) return null;
  return createClient(url, key);
}

export const db = getSupabase();

function loadFileStore(): FileStore {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      return {
        transactions: [],
        offers: [...defaultOffers],
        site_profile: { ...defaultProfile },
        app_settings: { ...defaultAppSettings },
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
    };
  } catch {
    return {
      transactions: [],
      offers: [...defaultOffers],
      site_profile: { ...defaultProfile },
      app_settings: { ...defaultAppSettings },
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
  const fromFile = loadFileStore().transactions.filter((t) => t.client_id === clientId);
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
  return {
    id: String(row.id),
    order_ref: String(row.order_ref ?? ""),
    client_id: String(row.client_id ?? ""),
    type: row.type === "buy" ? "buy" : "sell",
    amount: Number(row.amount),
    method: String(row.method ?? ""),
    status: String(row.status ?? "pending"),
    created_at:
      typeof row.created_at === "string"
        ? row.created_at
        : new Date(row.created_at as string).toISOString(),
    details: row.details != null ? String(row.details) : null,
  };
}

export async function createTransaction(input: {
  client_id: string;
  user_id?: string;
  type: "buy" | "sell";
  amount: number;
  method: string;
  details?: string;
}): Promise<ServerTransaction> {
  const order_ref = genOrderRef();
  const id = globalThis.crypto?.randomUUID?.() ?? `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const created_at = new Date().toISOString();
  const row: ServerTransaction = {
    id,
    order_ref,
    client_id: input.client_id,
    type: input.type,
    amount: input.amount,
    method: input.method,
    status: "pending",
    created_at,
    details: input.details ?? null,
  };

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
          details: input.details ?? null,
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
  store.transactions.unshift(row);
  saveFileStore(store);
  return row;
}

/** جميع الطلبات (ملف + قاعدة) لإحصاءات البوت ولوحة التحكم */
export async function listAllTransactionsMerged(): Promise<ServerTransaction[]> {
  const map = new Map<string, ServerTransaction>();
  for (const t of loadFileStore().transactions) {
    map.set(t.id, t);
  }
  if (db) {
    const { data, error } = await db
      .from("transactions")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(5000);
    if (error) console.error("listAllTransactionsMerged:", error);
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
  status: "pending" | "completed" | "failed"
): Promise<boolean> {
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
  return ok;
}

export async function listOffers(): Promise<ServerOffer[]> {
  if (db) {
    const { data, error } = await db
      .from("offers")
      .select("*")
      .eq("active", true)
      .order("sort_order", { ascending: true });
    if (error) {
      console.error("listOffers:", error);
      return defaultOffers;
    }
    if (!data?.length) return defaultOffers;
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
};

const APP_SETTING_KEYS = ["maintenance_mode", "buy_coming_soon", "sell_coming_soon"] as const;

export async function getAppSettings(): Promise<AppSettingsPublic> {
  const merged: Record<string, string> = { ...defaultAppSettings, ...loadFileStore().app_settings };
  if (db) {
    const { data, error } = await db.from("settings").select("key, value");
    if (error) console.error("getAppSettings db:", error);
    else if (data?.length) {
      for (const row of data as { key: string; value: string }[]) {
        if (row.key && typeof row.value === "string") merged[row.key] = row.value;
      }
    }
  }
  return {
    maintenance_mode: merged.maintenance_mode === "true",
    buy_coming_soon: merged.buy_coming_soon === "true",
    sell_coming_soon: merged.sell_coming_soon === "true",
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
