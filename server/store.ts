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
  permissions: string[]; // ['add_number', 'reset_balance']
  created_at: string;
};

export type Admin = {
  id: string;
  telegram_id: number;
  name: string;
  permissions: string[]; // ['manage_agents', 'site_settings', 'manage_admins', 'view_stats']
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

export type BotUser = {
  id: string; // uuid
  telegram_id: number;
  created_at: string;
};

type FileStore = {
  transactions: ServerTransaction[];
  offers: ServerOffer[];
  site_profile: SiteProfile;
  app_settings: Record<string, string>;
  agents: Agent[];
  agent_numbers: AgentNumber[];
  admins: Admin[];
  bot_users: BotUser[];
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
        agents: [],
        agent_numbers: [],
        admins: [],
        bot_users: [],
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
      agents: Array.isArray(parsed.agents) ? parsed.agents.map(a => ({ ...a, permissions: Array.isArray(a.permissions) ? a.permissions : ['add_number', 'reset_balance'] })) : [],
      agent_numbers: Array.isArray(parsed.agent_numbers) ? parsed.agent_numbers : [],
      admins: Array.isArray(parsed.admins) ? parsed.admins : [],
      bot_users: Array.isArray(parsed.bot_users) ? parsed.bot_users : [],
    };
  } catch {
    return {
      transactions: [],
      offers: [...defaultOffers],
      site_profile: { ...defaultProfile },
      app_settings: { ...defaultAppSettings },
      agents: [],
      agent_numbers: [],
      admins: [],
      bot_users: [],
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
    agent_number_id: row.agent_number_id != null ? String(row.agent_number_id) : null,
  };
}

export async function createTransaction(input: {
  client_id: string;
  user_id?: string;
  type: "buy" | "sell";
  amount: number;
  method: string;
  details?: string;
  agent_number_id?: string;
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
    agent_number_id: input.agent_number_id ?? null,
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
          agent_number_id: input.agent_number_id ?? null,
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
  status: string
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

/** AGENTS MANAGEMENT */

export async function listAgents(): Promise<Agent[]> {
  if (db) {
    const { data, error } = await db.from("agents").select("*").order("created_at", { ascending: false });
    if (!error && data) return data as Agent[];
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
    permissions: ['add_number', 'reset_balance'],
    created_at: new Date().toISOString(),
  };
  if (db) {
    await db.from("agents").insert([row]);
  }
  const st = loadFileStore();
  st.agents.unshift(row);
  saveFileStore(st);
  return row;
}

export async function toggleAgentActive(id: string, active: boolean): Promise<void> {
  if (db) {
    await db.from("agents").update({ is_active: active }).eq("id", id);
  }
  const st = loadFileStore();
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
  }
  const st = loadFileStore();
  st.agents = st.agents.filter(a => a.id !== id);
  st.agent_numbers = st.agent_numbers.filter(n => n.agent_id !== id);
  saveFileStore(st);
}

/** AGENT NUMBERS */

export async function listAgentNumbers(agentId?: string): Promise<AgentNumber[]> {
  if (db) {
    let query = db.from("agent_numbers").select("*").order("sort_order", { ascending: true });
    if (agentId) query = query.eq("agent_id", agentId);
    const { data, error } = await query;
    if (!error && data) return data as AgentNumber[];
  }
  const nums = loadFileStore().agent_numbers;
  return agentId ? nums.filter(n => n.agent_id === agentId).sort((a,b) => a.sort_order - b.sort_order) : nums;
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

/** ACTIVE NUMBER LOGIC */

export async function getActiveSellNumber(): Promise<{ phoneNumber: string; agentId: string; numberId: string } | null> {
  const agents = await listAgents();
  const activeAgent = agents.find(a => a.is_active);
  if (!activeAgent) return null;

  const numbers = await listAgentNumbers(activeAgent.id);
  const activeNum = numbers.find(n => !n.is_exhausted && n.balance < 300000);
  
  if (!activeNum) return null;
  
  return { 
    phoneNumber: activeNum.phone_number,
    agentId: activeAgent.id,
    numberId: activeNum.id
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
    if (!error && data) return data as Admin[];
  }
  return loadFileStore().admins;
}

export async function createAdmin(input: { telegram_id: number; name: string }): Promise<Admin> {
  const id = globalThis.crypto?.randomUUID?.() ?? `admin-${Date.now()}`;
  const row: Admin = {
    id,
    telegram_id: input.telegram_id,
    name: input.name,
    permissions: ['manage_agents', 'site_settings', 'view_stats'], // Default
    created_at: new Date().toISOString(),
  };
  if (db) await db.from("admins").insert([row]);
  const st = loadFileStore();
  st.admins.unshift(row);
  saveFileStore(st);
  return row;
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
  const store = loadFileStore();
  const exists = store.bot_users.find((u) => u.telegram_id === telegramId);
  if (exists) return exists;

  const newUser: BotUser = {
    id: globalThis.crypto?.randomUUID?.() ?? `botuser-${Date.now()}`,
    telegram_id: telegramId,
    created_at: new Date().toISOString(),
  };
  store.bot_users.push(newUser);
  saveFileStore(store);

  if (db) {
    await db.from("bot_users").upsert({
      telegram_id: telegramId,
      created_at: newUser.created_at,
    });
  }
  return newUser;
}

export async function listBotUsers() {
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
  const store = loadFileStore();
  store.offers = store.offers.filter((o) => o.id !== id);
  saveFileStore(store);

  if (db) {
    await db.from("offers").delete().eq("id", id);
  }
}
