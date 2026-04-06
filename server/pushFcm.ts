import { GoogleAuth } from "google-auth-library";
import * as store from "./store";

/** Legacy HTTP API — مفتاح الخادم من Firebase → إعدادات المشروع → Cloud Messaging */
const FCM_LEGACY_URL = "https://fcm.googleapis.com/fcm/send";

const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

type FcmMulticastResponse = {
  success?: number;
  failure?: number;
  results?: { message_id?: string; error?: string }[];
};

type ServiceAccountJson = {
  project_id?: string;
  client_email?: string;
  private_key?: string;
};

function parseServiceAccount(): ServiceAccountJson | null {
  const raw = process.env.FCM_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ServiceAccountJson;
  } catch {
    console.error("FCM_SERVICE_ACCOUNT_JSON: invalid JSON");
    return null;
  }
}

async function getFcmV1AccessToken(credentials: ServiceAccountJson): Promise<string | null> {
  try {
    const auth = new GoogleAuth({
      credentials,
      scopes: [FCM_SCOPE],
    });
    const client = await auth.getClient();
    const tokenResponse = await client.getAccessToken();
    const token = tokenResponse?.token;
    return token ?? null;
  } catch (e) {
    console.error("FCM v1 getAccessToken:", e);
    return null;
  }
}

/** إرسال عبر FCM HTTP v1 (الطريقة الموصى بها؛ مفتاح حساب الخدمة من JSON) */
async function sendFcmV1(
  projectId: string,
  accessToken: string,
  title: string,
  body: string,
  tokens: string[],
): Promise<{ sent: number; invalid: string[] }> {
  const url = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`;
  let sent = 0;
  const invalid: string[] = [];

  for (const token of tokens) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: {
            token,
            notification: {
              title: title.slice(0, 200),
              body: body.slice(0, 2000),
            },
            android: { priority: "HIGH" },
            apns: {
              payload: {
                aps: {
                  sound: "default",
                },
              },
            },
          },
        }),
      });
      const json = (await res.json()) as {
        name?: string;
        error?: { status?: string; message?: string; details?: { errorCode?: string }[] };
      };
      if (res.ok && json.name) {
        sent += 1;
        continue;
      }
      const errCode = json.error?.details?.find((d) => d.errorCode)?.errorCode;
      if (
        errCode === "UNREGISTERED" ||
        errCode === "INVALID_ARGUMENT" ||
        res.status === 404 ||
        json.error?.status === "NOT_FOUND"
      ) {
        invalid.push(token);
      } else {
        console.error("FCM v1 error:", res.status, json);
      }
    } catch (e) {
      console.error("FCM v1 fetch:", e);
    }
  }

  return { sent, invalid };
}

/** إرسال FCM لقائمة رموز (مشترك بين البث والعميل الواحد) */
async function deliverFcm(tokens: string[], title: string, body: string): Promise<{ sent: number; invalid: string[] }> {
  const serverKey = process.env.FCM_SERVER_KEY?.trim();
  const sa = parseServiceAccount();
  if (!serverKey && !sa?.project_id) {
    return { sent: 0, invalid: [] };
  }
  if (tokens.length === 0) {
    return { sent: 0, invalid: [] };
  }

  const invalid: string[] = [];
  let sent = 0;

  if (sa?.project_id && !serverKey) {
    const accessToken = await getFcmV1AccessToken(sa);
    if (!accessToken) {
      return { sent: 0, invalid: [] };
    }
    const r = await sendFcmV1(sa.project_id, accessToken, title, body, tokens);
    sent = r.sent;
    invalid.push(...r.invalid);
  } else if (serverKey) {
    const chunkSize = 500;
    for (let i = 0; i < tokens.length; i += chunkSize) {
      const registration_ids = tokens.slice(i, i + chunkSize);
      try {
        const res = await fetch(FCM_LEGACY_URL, {
          method: "POST",
          headers: {
            Authorization: `key=${serverKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            registration_ids,
            notification: {
              title: title.slice(0, 200),
              body: body.slice(0, 2000),
              sound: "default",
            },
            priority: "high",
            content_available: true,
          }),
        });
        const json = (await res.json()) as FcmMulticastResponse & { error?: string };
        if (!res.ok) {
          console.error("FCM HTTP error:", res.status, json);
          continue;
        }
        const results = json.results;
        if (Array.isArray(results)) {
          results.forEach((r, idx) => {
            if (r.message_id) sent += 1;
            const err = r.error;
            if (
              err &&
              (err === "NotRegistered" || err === "InvalidRegistration" || err === "MismatchSenderId")
            ) {
              const t = registration_ids[idx];
              if (t) invalid.push(t);
            }
          });
        } else if (typeof json.success === "number") {
          sent += json.success;
        }
      } catch (e) {
        console.error("FCM fetch:", e);
      }
    }
  }

  return { sent, invalid };
}

/** إشعار عميل واحد (حالة الطلب) — لا يعطل السيرفر عند الفشل */
export async function sendFcmToClient(clientId: string, title: string, body: string): Promise<void> {
  try {
    const cid = clientId.trim();
    if (!cid) return;
    const rows = await store.listPushTokens();
    const tokens = [
      ...new Set(rows.filter((r) => r.client_id === cid).map((r) => r.token).filter(Boolean)),
    ];
    if (tokens.length === 0) return;
    const { invalid } = await deliverFcm(tokens, title, body);
    if (invalid.length) {
      await store.removePushTokens([...new Set(invalid)]);
    }
  } catch (e) {
    console.error("sendFcmToClient:", e);
  }
}

/** إشعار FCM عند تغيّر حالة الطلب (شراء/رفض وغيرها) */
export async function notifyOrderStatusByRef(orderRef: string, status: string): Promise<void> {
  const all = await store.listAllTransactionsMerged();
  const tx = all.find((t) => t.order_ref === orderRef);
  if (!tx?.client_id) return;
  const ref = orderRef;
  let title: string;
  let body: string;
  switch (status) {
    case "completed":
      title = "تم إكمال الطلب ✅";
      body = `طلبك #${ref} تم بنجاح.`;
      break;
    case "failed":
      title = "تم رفض الطلب ❌";
      body = `طلبك #${ref} لم يُعتمد أو أُلغي.`;
      break;
    case "refunded":
      title = "استرجاع ↩️";
      body = `تم تسجيل الاسترجاع للطلب #${ref}.`;
      break;
    case "suspended":
      title = "طلب معلّق ⏸";
      body = `طلبك #${ref} في حالة تعليق.`;
      break;
    case "retry_otp":
      title = "تحقق من الرمز";
      body = `أعد إدخال رمز التحقق للطلب #${ref}.`;
      break;
    default:
      return;
  }
  await sendFcmToClient(tx.client_id, title, body);
}

export async function sendFcmAnnouncement(title: string, body: string): Promise<{
  sent: number;
  failed: number;
  invalidTokensRemoved: number;
  error?: string;
}> {
  const serverKey = process.env.FCM_SERVER_KEY?.trim();
  const sa = parseServiceAccount();

  if (!serverKey && !sa?.project_id) {
    return {
      sent: 0,
      failed: 0,
      invalidTokensRemoved: 0,
      error: "missing_fcm_credentials",
    };
  }

  const rows = await store.listPushTokens();
  const tokens = [...new Set(rows.map((r) => r.token).filter(Boolean))];
  if (tokens.length === 0) {
    return { sent: 0, failed: 0, invalidTokensRemoved: 0, error: "no_tokens" };
  }

  if (sa?.project_id && !serverKey) {
    const accessToken = await getFcmV1AccessToken(sa);
    if (!accessToken) {
      return {
        sent: 0,
        failed: 0,
        invalidTokensRemoved: 0,
        error: "fcm_v1_token_failed",
      };
    }
  }

  const { sent, invalid } = await deliverFcm(tokens, title, body);

  if (invalid.length) {
    await store.removePushTokens([...new Set(invalid)]);
  }

  return {
    sent,
    failed: Math.max(0, tokens.length - sent),
    invalidTokensRemoved: invalid.length,
  };
}
