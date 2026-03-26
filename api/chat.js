import {
  API_KEY,
  NVIDIA_API_KEY,
  GROQ_API_KEY,
  AI_ENABLED,
  LLM_TIMEOUT_MS,
  LLM_PROVIDER,
  SYSTEM_PROMPT_CHAT,
  sendJson,
  readJson,
  callLLM
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

  const provider = LLM_PROVIDER.toLowerCase();
  const missingKey =
    provider === "nvidia"
      ? !NVIDIA_API_KEY
      : provider === "groq"
        ? !GROQ_API_KEY
        : !API_KEY;
  if (!AI_ENABLED || missingKey) {
    sendJson(res, 200, { reply: "AI is currently off to save API key usage. Turn it back on when you’re ready." });
    return;
  }

  try {
    const payload = await readJson(req);
    const messages = Array.isArray(payload.messages) ? payload.messages : [];
    const context = payload.context || null;

    const trimmed = messages
      .filter((m) => m && typeof m.content === "string" && (m.role === "user" || m.role === "assistant"))
      .slice(-14);

    const contents = trimmed.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }]
    }));

    const contextBlob = context
      ? `User context (do not repeat verbatim):\n${JSON.stringify(context).slice(0, 12000)}`
      : "No survey context available.";

    const { text } = await callLLM({
      system: `${SYSTEM_PROMPT_CHAT}\n\n${contextBlob}`,
      contents
    });

    sendJson(res, 200, { reply: text });
  } catch (error) {
    if (error?.reason === "LLM_TIMEOUT" || error?.code === 504) {
      sendJson(res, 504, {
        error: {
          message: "AI is taking longer than usual. Please try again in a moment.",
          reason: "LLM_TIMEOUT",
          timeout_ms: LLM_TIMEOUT_MS
        }
      });
      return;
    }
    if (error?.reason === "RESOURCE_EXHAUSTED" || error?.code === 429) {
      sendJson(res, 429, {
        error: {
          message: error.message || "Rate limit exceeded. Please retry shortly.",
          reason: error.reason || "RESOURCE_EXHAUSTED",
          retry_after_ms: error.retryAfterMs || 60000
        }
      });
      return;
    }
    sendJson(res, 500, {
      error: {
        message: error.message || "Server error",
        reason: error.reason || "SERVER_ERROR",
        code: error.code
      }
    });
  }
}
