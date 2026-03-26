import {
  SHEETS_WEBHOOK_URL,
  SHEETS_WEBHOOK_TOKEN,
  sendJson,
  readJson
} from "./_shared.js";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    sendJson(res, 204, {});
    return;
  }
  if (req.method !== "POST") {
    sendJson(res, 405, { error: { message: "Method not allowed" } });
    return;
  }

  try {
    if (!SHEETS_WEBHOOK_URL) {
      sendJson(res, 500, {
        error: {
          message:
            "Missing SHEETS_WEBHOOK_URL. Create a Google Apps Script webhook and set SHEETS_WEBHOOK_URL in env."
        }
      });
      return;
    }

    const payload = await readJson(req);
    const body = JSON.stringify(payload || {});

    const headers = { "Content-Type": "application/json" };
    let webhookUrl = SHEETS_WEBHOOK_URL;
    if (SHEETS_WEBHOOK_TOKEN) {
      headers["x-webhook-token"] = String(SHEETS_WEBHOOK_TOKEN);
      try {
        const u = new URL(SHEETS_WEBHOOK_URL);
        u.searchParams.set("token", String(SHEETS_WEBHOOK_TOKEN));
        webhookUrl = u.toString();
      } catch {
        // ignore
      }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let resp;
    try {
      resp = await fetch(webhookUrl, {
        method: "POST",
        headers,
        body,
        signal: controller.signal
      });
    } catch (e) {
      if (e?.name === "AbortError") {
        sendJson(res, 504, { error: { message: "Sheets webhook timeout." } });
        return;
      }
      throw e;
    } finally {
      clearTimeout(timeout);
    }

    if (!resp.ok) {
      const txt = await resp.text();
      sendJson(res, 502, { error: { message: "Sheets webhook error", detail: txt.slice(0, 800) } });
      return;
    }

    const ct = (resp.headers.get("content-type") || "").toLowerCase();
    const txt = await resp.text();
    if (ct.includes("application/json")) {
      let parsed = null;
      try {
        parsed = JSON.parse(txt || "{}");
      } catch {
        parsed = null;
      }
      if (parsed?.ok === true) {
        sendJson(res, 200, { ok: true });
        return;
      }
      sendJson(res, 502, {
        error: {
          message: "Sheets webhook did not confirm ok:true",
          detail: JSON.stringify(parsed || {}).slice(0, 800)
        }
      });
      return;
    }

    sendJson(res, 502, {
      error: {
        message: "Sheets webhook returned non-JSON (likely auth/permissions).",
        detail: String(txt || "").slice(0, 800)
      }
    });
  } catch (error) {
    sendJson(res, 500, { error: { message: error.message || "Server error" } });
  }
}
