import * as store from "./store";

/** Legacy HTTP API — يحتاج مفتاح الخادم من Firebase Console → Cloud Messaging */
const FCM_URL = "https://fcm.googleapis.com/fcm/send";

type FcmMulticastResponse = {
  success?: number;
  failure?: number;
  results?: { message_id?: string; error?: string }[];
};

export async function sendFcmAnnouncement(title: string, body: string): Promise<{
  sent: number;
  failed: number;
  invalidTokensRemoved: number;
  error?: string;
}> {
  const serverKey = process.env.FCM_SERVER_KEY?.trim();
  if (!serverKey) {
    return { sent: 0, failed: 0, invalidTokensRemoved: 0, error: "missing FCM_SERVER_KEY" };
  }

  const rows = await store.listPushTokens();
  const tokens = [...new Set(rows.map((r) => r.token).filter(Boolean))];
  if (tokens.length === 0) {
    return { sent: 0, failed: 0, invalidTokensRemoved: 0, error: "no_tokens" };
  }

  const invalid: string[] = [];
  let sent = 0;
  const chunkSize = 500;

  for (let i = 0; i < tokens.length; i += chunkSize) {
    const registration_ids = tokens.slice(i, i + chunkSize);
    try {
      const res = await fetch(FCM_URL, {
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

  if (invalid.length) {
    await store.removePushTokens([...new Set(invalid)]);
  }

  return {
    sent,
    failed: Math.max(0, tokens.length - sent),
    invalidTokensRemoved: invalid.length,
  };
}
