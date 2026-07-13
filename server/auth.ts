/**
 * Local auth on Railway PostgreSQL (no Supabase).
 * Password: scrypt. Session: opaque token (SHA-256 stored).
 */
import * as crypto from "node:crypto";
import { hasPg, pgOne, pgQuery } from "./pg.js";

export type AuthUser = {
  id: string;
  email: string;
  full_name: string | null;
  role: "user" | "admin";
  balance: number;
  created_at: string;
};

const SESSION_DAYS = 30;

function requirePg(): void {
  if (!hasPg()) {
    throw new Error("DATABASE_URL is required for authentication");
  }
}

function scryptAsync(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (err, key) => {
      if (err) reject(err);
      else resolve(key as Buffer);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await scryptAsync(password, salt);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const [algo, saltHex, hashHex] = stored.split("$");
    if (algo !== "scrypt" || !saltHex || !hashHex) return false;
    const salt = Buffer.from(saltHex, "hex");
    const expected = Buffer.from(hashHex, "hex");
    const actual = await scryptAsync(password, salt);
    if (actual.length !== expected.length) return false;
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function rowToUser(row: Record<string, unknown>): AuthUser {
  return {
    id: String(row.id),
    email: String(row.email ?? "").toLowerCase(),
    full_name: row.full_name != null ? String(row.full_name) : null,
    role: row.role === "admin" ? "admin" : "user",
    balance: Number(row.balance ?? 0),
    created_at:
      typeof row.created_at === "string"
        ? row.created_at
        : new Date(row.created_at as string).toISOString(),
  };
}

export async function findUserByEmail(email: string): Promise<(AuthUser & { password_hash: string }) | null> {
  requirePg();
  const normalized = email.trim().toLowerCase();
  const row = await pgOne(
    `SELECT id, email, password_hash, full_name, role, balance, created_at
     FROM users WHERE lower(email) = $1 LIMIT 1`,
    [normalized]
  );
  if (!row) return null;
  return { ...rowToUser(row as Record<string, unknown>), password_hash: String(row.password_hash) };
}

export async function findUserById(id: string): Promise<AuthUser | null> {
  requirePg();
  const row = await pgOne(
    `SELECT id, email, full_name, role, balance, created_at FROM users WHERE id = $1`,
    [id]
  );
  return row ? rowToUser(row as Record<string, unknown>) : null;
}

export async function createUser(input: {
  email: string;
  password: string;
  fullName?: string | null;
  role?: "user" | "admin";
}): Promise<AuthUser> {
  requirePg();
  const email = input.email.trim().toLowerCase();
  const password = input.password.trim();
  if (!email || !password) throw new Error("missing_fields");
  if (password.length < 6) throw new Error("weak_password");

  const existing = await findUserByEmail(email);
  if (existing) {
    const err = new Error("email_exists");
    (err as Error & { code?: string }).code = "email_exists";
    throw err;
  }

  const id = crypto.randomUUID();
  const password_hash = await hashPassword(password);
  const full_name = input.fullName?.trim() || null;
  const role = input.role === "admin" ? "admin" : "user";
  const created_at = new Date().toISOString();

  await pgQuery(
    `INSERT INTO users (id, email, password_hash, full_name, role, balance, created_at)
     VALUES ($1,$2,$3,$4,$5,0,$6)`,
    [id, email, password_hash, full_name, role, created_at]
  );

  return {
    id,
    email,
    full_name,
    role,
    balance: 0,
    created_at,
  };
}

export async function updateUserPassword(userId: string, password: string): Promise<void> {
  requirePg();
  if (password.trim().length < 6) throw new Error("weak_password");
  const password_hash = await hashPassword(password.trim());
  await pgQuery(`UPDATE users SET password_hash = $1 WHERE id = $2`, [password_hash, userId]);
}

export async function updateUserEmail(userId: string, email: string): Promise<void> {
  requirePg();
  const normalized = email.trim().toLowerCase();
  if (!normalized) throw new Error("missing_email");
  await pgQuery(`UPDATE users SET email = $1 WHERE id = $2`, [normalized, userId]);
}

export async function updateUserProfile(
  userId: string,
  patch: { full_name?: string | null; role?: "user" | "admin" }
): Promise<void> {
  requirePg();
  if (patch.full_name !== undefined) {
    await pgQuery(`UPDATE users SET full_name = $1 WHERE id = $2`, [
      patch.full_name?.trim() || null,
      userId,
    ]);
  }
  if (patch.role) {
    await pgQuery(`UPDATE users SET role = $1 WHERE id = $2`, [patch.role, userId]);
  }
}

export async function setUserRole(userId: string, role: "user" | "admin"): Promise<void> {
  await updateUserProfile(userId, { role });
}

export async function createSession(userId: string): Promise<{ token: string; expiresAt: string }> {
  requirePg();
  const token = crypto.randomBytes(32).toString("base64url");
  const token_hash = hashToken(token);
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  const expiresAt = expires.toISOString();
  await pgQuery(
    `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
     VALUES ($1,$2,$3,$4,now())`,
    [crypto.randomUUID(), userId, token_hash, expiresAt]
  );
  return { token, expiresAt };
}

export async function deleteSessionByToken(token: string): Promise<void> {
  if (!hasPg() || !token.trim()) return;
  await pgQuery(`DELETE FROM sessions WHERE token_hash = $1`, [hashToken(token.trim())]);
}

export async function deleteAllSessionsForUser(userId: string): Promise<void> {
  requirePg();
  await pgQuery(`DELETE FROM sessions WHERE user_id = $1`, [userId]);
}

export async function getUserFromToken(token: string | null | undefined): Promise<AuthUser | null> {
  if (!token?.trim() || !hasPg()) return null;
  const token_hash = hashToken(token.trim());
  const row = await pgOne(
    `SELECT u.id, u.email, u.full_name, u.role, u.balance, u.created_at, s.expires_at
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1
     LIMIT 1`,
    [token_hash]
  );
  if (!row) return null;
  const exp = new Date(String(row.expires_at)).getTime();
  if (!Number.isFinite(exp) || exp < Date.now()) {
    await pgQuery(`DELETE FROM sessions WHERE token_hash = $1`, [token_hash]);
    return null;
  }
  return rowToUser(row as Record<string, unknown>);
}

export function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const m = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  return m?.[1]?.trim() || null;
}

export async function loginWithPassword(
  email: string,
  password: string
): Promise<{ user: AuthUser; token: string; expiresAt: string } | null> {
  const found = await findUserByEmail(email);
  if (!found) return null;
  const ok = await verifyPassword(password, found.password_hash);
  if (!ok) return null;
  const session = await createSession(found.id);
  const user = await findUserById(found.id);
  if (!user) return null;
  return { user, token: session.token, expiresAt: session.expiresAt };
}

/** Upsert admin web account (create or update password / promote role). */
export async function ensureAdminWebAccount(
  email: string,
  password: string,
  name: string
): Promise<AuthUser> {
  const normalizedEmail = email.trim().toLowerCase();
  const normalizedPassword = password.trim();
  if (!normalizedEmail) throw new Error("يرجى إرسال الإيميل.");
  if (normalizedPassword.length < 6) throw new Error("كلمة المرور يجب أن تكون 6 أحرف أو أكثر.");

  const existing = await findUserByEmail(normalizedEmail);
  if (existing) {
    await updateUserPassword(existing.id, normalizedPassword);
    await updateUserProfile(existing.id, { full_name: name, role: "admin" });
    const user = await findUserById(existing.id);
    if (!user) throw new Error("تعذر تحديث حساب الأدمن.");
    return user;
  }
  return createUser({
    email: normalizedEmail,
    password: normalizedPassword,
    fullName: name,
    role: "admin",
  });
}

export async function updateAdminWebAuth(params: {
  currentEmail?: string | null;
  nextEmail?: string | null;
  nextPassword?: string | null;
  name: string;
}): Promise<{ created: boolean; userEmail: string }> {
  const currentEmail = (params.currentEmail || "").trim().toLowerCase();
  const nextEmail = (params.nextEmail || "").trim().toLowerCase();
  const nextPassword = (params.nextPassword || "").trim();
  if (!nextEmail && !currentEmail) {
    throw new Error("لا يمكن تعديل دخول الويب بدون إيميل مرتبط بالحساب.");
  }
  if (nextPassword && nextPassword.length < 6) {
    throw new Error("كلمة المرور يجب أن تكون 6 أحرف أو أكثر.");
  }

  let user = currentEmail ? await findUserByEmail(currentEmail) : null;
  if (!user && nextEmail) user = await findUserByEmail(nextEmail);

  if (!user) {
    if (!nextEmail || !nextPassword) {
      throw new Error("لا يوجد حساب مطابق. أرسل الإيميل + كلمة مرور لإنشاء حساب جديد.");
    }
    await createUser({
      email: nextEmail,
      password: nextPassword,
      fullName: params.name,
      role: "admin",
    });
    return { created: true, userEmail: nextEmail };
  }

  if (nextEmail && nextEmail !== user.email) {
    const clash = await findUserByEmail(nextEmail);
    if (clash && clash.id !== user.id) {
      throw new Error("هذا البريد مستخدم لحساب آخر.");
    }
    await updateUserEmail(user.id, nextEmail);
  }
  if (nextPassword) {
    await updateUserPassword(user.id, nextPassword);
  }
  await updateUserProfile(user.id, { full_name: params.name, role: "admin" });
  return { created: false, userEmail: nextEmail || currentEmail || user.email };
}

export async function getUserBalance(userId: string): Promise<number> {
  if (!userId.trim() || !hasPg()) return 0;
  const row = await pgOne(`SELECT balance FROM users WHERE id = $1`, [userId]);
  return row ? Number(row.balance ?? 0) : 0;
}

export async function adjustUserBalance(userId: string, delta: number): Promise<number> {
  if (!userId.trim() || delta === 0 || !hasPg()) return getUserBalance(userId);
  const res = await pgQuery(
    `UPDATE users
     SET balance = GREATEST(0, COALESCE(balance, 0) + $1)
     WHERE id = $2
     RETURNING balance`,
    [delta, userId]
  );
  if (!res.rows[0]) return 0;
  return Number(res.rows[0].balance ?? 0);
}

export async function getUserFullName(userId: string): Promise<string | null> {
  if (!userId.trim() || !hasPg()) return null;
  const row = await pgOne(`SELECT full_name FROM users WHERE id = $1`, [userId]);
  const name = row?.full_name != null ? String(row.full_name).trim() : "";
  return name || null;
}

/** Create bootstrap admin from env if none exists. */
export async function maybeSeedBootstrapAdmin(): Promise<void> {
  if (!hasPg()) return;
  const email = (process.env.BOOTSTRAP_ADMIN_EMAIL || process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  const password = (process.env.BOOTSTRAP_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || "").trim();
  if (!email || password.length < 6) return;

  try {
    const count = await pgOne<{ n: string }>(`SELECT COUNT(*)::text AS n FROM users WHERE role = 'admin'`);
    if (Number(count?.n ?? 0) > 0) return;
    const existing = await findUserByEmail(email);
    if (existing) {
      await updateUserProfile(existing.id, { role: "admin" });
      console.log("✅ Bootstrap: promoted existing user to admin:", email);
      return;
    }
    await createUser({ email, password, fullName: "Admin", role: "admin" });
    console.log("✅ Bootstrap admin created:", email);
  } catch (e) {
    console.warn("Bootstrap admin seed skipped:", e);
  }
}
