import fs from "fs";
import path from "path";
import crypto from "crypto";

const cwd = process.cwd();
const envPath = path.join(cwd, ".env");
let env = {};
if (fs.existsSync(envPath)) {
  const raw = fs.readFileSync(envPath, "utf-8");
  env = Object.fromEntries(
    raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const [key, ...rest] = line.split("=");
        let value = rest.join("=").trim();
        if (
          (value.startsWith("\"") && value.endsWith("\"")) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        return [key, value];
      })
  );
}

export const API_KEY = process.env.GEMINI_API_KEY || env.GEMINI_API_KEY;
export const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY || env.NVIDIA_API_KEY;
export const GROQ_API_KEY = process.env.GROQ_API_KEY || env.GROQ_API_KEY;
export const SHEETS_WEBHOOK_URL = process.env.SHEETS_WEBHOOK_URL || env.SHEETS_WEBHOOK_URL;
export const SHEETS_WEBHOOK_TOKEN = process.env.SHEETS_WEBHOOK_TOKEN || env.SHEETS_WEBHOOK_TOKEN;
export const AI_ENABLED =
  (process.env.AI_ENABLED ?? env.AI_ENABLED ?? "1").toString().trim() !== "0";
export const AI_REPAIR_JSON =
  (process.env.AI_REPAIR_JSON ?? env.AI_REPAIR_JSON ?? "1").toString().trim() !== "0";
export const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS ?? env.LLM_TIMEOUT_MS ?? 45000);

const RAW_LLM_PROVIDER = (process.env.LLM_PROVIDER ?? env.LLM_PROVIDER ?? "")
  .toString()
  .trim()
  .toLowerCase();
export const LLM_PROVIDER = RAW_LLM_PROVIDER ||
  (GROQ_API_KEY ? "groq" : NVIDIA_API_KEY ? "nvidia" : "gemini");
export const GEMINI_MODEL = (process.env.GEMINI_MODEL ?? env.GEMINI_MODEL ?? "gemini-2.5-flash")
  .toString()
  .trim();
export const NVIDIA_MODEL = (process.env.NVIDIA_MODEL ?? env.NVIDIA_MODEL ?? "qwen/qwen3.5-122b-a10b")
  .toString()
  .trim();
export const GROQ_MODEL = (process.env.GROQ_MODEL ?? env.GROQ_MODEL ?? "llama-3.1-8b-instant")
  .toString()
  .trim();

const NOTES_PATH = path.join(cwd, "knowledge", "jay_shetty_shade_summary.txt");
let PODCAST_NOTES = "";
try {
  if (fs.existsSync(NOTES_PATH)) {
    PODCAST_NOTES = fs.readFileSync(NOTES_PATH, "utf-8").trim();
  }
} catch {
  PODCAST_NOTES = "";
}

export const SYSTEM_PROMPT_ANALYZE = [
  "System Prompt: The Big Trust AI Coach",
  "",
  "You are a behavioral coaching AI based on Dr. Shadé Zahrai’s Big Trust framework.",
  "Self-doubt is a misguided protector; confidence is rewired through tiny proof points.",
  "",
  "Return STRICT JSON ONLY. No markdown. No extra keys.",
  "All strings must be single-line (no newline characters). Double quotes only.",
  "",
  "Output keys:",
  "{",
  "  \"psychological_insight\": string,",
  "  \"lesson\": { \"title\": string, \"points\": [string, string, string] },",
  "  \"focus_experiments\": [ {\"title\": string, \"action\": string, \"why\": string}, {\"title\": string, \"action\": string, \"why\": string}, {\"title\": string, \"action\": string, \"why\": string} ]",
  "}"
].join("\n");

export const SYSTEM_PROMPT_EXPERIMENTS = [
  "You are the Big Trust AI Coach. Generate varied, concrete tiny experiments (<= 10 minutes).",
  "Each experiment must feel DIFFERENT from the others — different format, different moment in the day, different social context.",
  "Avoid repeating the same core action with different wording.",
  "",
  "Return STRICT JSON ONLY. No markdown. No extra keys.",
  "All strings must be single-line (no newline characters). Double quotes only.",
  "",
  "Output keys:",
  "{",
  "  \"category\": \"Acceptance\" | \"Agency\" | \"Autonomy\" | \"Adaptability\",",
  "  \"experiments\": [",
  "    {\"title\": string, \"action\": string, \"why\": string},",
  "    {\"title\": string, \"action\": string, \"why\": string},",
  "    {\"title\": string, \"action\": string, \"why\": string}",
  "  ]",
  "}"
].join("\n");

export const SYSTEM_PROMPT_CHAT = [
  "You are the Big Trust AI Coach (Dr. Shadé Zahrai’s Big Trust framework).",
  "Self-doubt is a misguided protector. We rewire confidence through tiny experiments.",
  "",
  "Use these categories and language when helpful: Acceptance (Self-Esteem), Agency (Self-Efficacy), Autonomy (Locus of Control), Adaptability (Emotional Stability).",
  "",
  "Rules:",
  "- Be concise and warm. Ask at most ONE question at a time.",
  "- Give 1 small actionable step per reply.",
  "- Avoid long paragraphs."
].join("\n");

export function sendJson(res, status, payload, extraHeaders = {}) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-goog-api-key");
  Object.entries(extraHeaders).forEach(([k, v]) => res.setHeader(k, v));
  res.end(JSON.stringify(payload));
}

export function readJson(req) {
  if (req.body && typeof req.body === "object") return Promise.resolve(req.body);
  if (req.body && typeof req.body === "string") {
    try {
      return Promise.resolve(JSON.parse(req.body));
    } catch {
      return Promise.resolve({});
    }
  }
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

export function tryParseJsonLoose(text) {
  if (!text || typeof text !== "string") return null;
  try {
    return JSON.parse(text);
  } catch {
    try {
      const trimmed = text.trim();
      const start = trimmed.indexOf("{");
      const end = trimmed.lastIndexOf("}");
      if (start !== -1 && end !== -1 && end > start) {
        return JSON.parse(trimmed.slice(start, end + 1));
      }
    } catch {
      return null;
    }
  }
  return null;
}

async function callGemini({ system, contents, responseMimeType, generationConfig }) {
  const userText = contents?.[0]?.parts?.map((p) => p.text).join("\n") || "";
  const body = {
    system_instruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: userText }] }],
    generationConfig
  };
  if (responseMimeType) body.generationConfig = { ...generationConfig, responseMimeType };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${API_KEY}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } catch (e) {
    clearTimeout(timeout);
    if (e?.name === "AbortError") {
      const err = new Error(`LLM timeout after ${LLM_TIMEOUT_MS}ms`);
      err.reason = "LLM_TIMEOUT";
      err.code = 504;
      throw err;
    }
    throw e;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const errorText = await response.text();
    let parsedError = null;
    try {
      parsedError = JSON.parse(errorText);
    } catch {
      parsedError = null;
    }
    const err = new Error(parsedError?.error?.message || errorText || "Gemini API error");
    err.reason = parsedError?.error?.status || parsedError?.error?.code || "GEMINI_API_ERROR";
    err.status = response.status;
    err.code = response.status;
    const retryAfter = response.headers.get("retry-after");
    if (retryAfter) err.retryAfterMs = Math.ceil(Number(retryAfter) * 1000);
    throw err;
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("\n") || "";
  return { text, raw: data };
}

async function callNvidia({ system, contents, generationConfig }) {
  const userText = contents?.[0]?.parts?.map((p) => p.text).join("\n") || "";
  const body = {
    model: NVIDIA_MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: userText }
    ],
    temperature: generationConfig?.temperature ?? 0.0,
    top_p: generationConfig?.topP ?? generationConfig?.top_p ?? 0.2,
    max_tokens: generationConfig?.maxOutputTokens ?? generationConfig?.max_tokens ?? 1600,
    stream: false
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  let response;
  try {
    response = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${NVIDIA_API_KEY}`,
        Accept: "application/json"
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } catch (e) {
    clearTimeout(timeout);
    if (e?.name === "AbortError") {
      const err = new Error(`LLM timeout after ${LLM_TIMEOUT_MS}ms`);
      err.reason = "LLM_TIMEOUT";
      err.code = 504;
      throw err;
    }
    throw e;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const errorText = await response.text();
    let parsedError = null;
    try {
      parsedError = JSON.parse(errorText);
    } catch {
      parsedError = null;
    }
    const err = new Error(parsedError?.error?.message || errorText || "NVIDIA API error");
    err.reason = parsedError?.error?.type || parsedError?.error?.code || "NVIDIA_API_ERROR";
    err.status = response.status;
    err.code = response.status;
    const retryAfter = response.headers.get("retry-after");
    if (retryAfter) err.retryAfterMs = Math.ceil(Number(retryAfter) * 1000);
    throw err;
  }

  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content || "";
  return { text, raw: data };
}

async function callGroq({ system, contents, responseMimeType, generationConfig }) {
  const userText = contents?.[0]?.parts?.map((p) => p.text).join("\n") || "";
  const body = {
    model: GROQ_MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: userText }
    ],
    temperature: generationConfig?.temperature ?? 0.0,
    top_p: generationConfig?.topP ?? generationConfig?.top_p ?? 0.2,
    max_tokens: generationConfig?.maxOutputTokens ?? generationConfig?.max_tokens ?? 1600,
    stream: false
  };
  if (responseMimeType === "application/json") {
    body.response_format = { type: "json_object" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  let response;
  try {
    response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GROQ_API_KEY}`,
        Accept: "application/json"
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } catch (e) {
    clearTimeout(timeout);
    if (e?.name === "AbortError") {
      const err = new Error(`LLM timeout after ${LLM_TIMEOUT_MS}ms`);
      err.reason = "LLM_TIMEOUT";
      err.code = 504;
      throw err;
    }
    throw e;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const errorText = await response.text();
    let parsedError = null;
    try {
      parsedError = JSON.parse(errorText);
    } catch {
      parsedError = null;
    }
    const err = new Error(parsedError?.error?.message || errorText || "Groq API error");
    err.reason = parsedError?.error?.type || parsedError?.error?.code || "GROQ_API_ERROR";
    err.status = response.status;
    err.code = response.status;
    const retryAfter = response.headers.get("retry-after");
    if (retryAfter) err.retryAfterMs = Math.ceil(Number(retryAfter) * 1000);
    throw err;
  }

  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content || "";
  return { text, raw: data };
}

export async function callLLM({ system, contents, responseMimeType, generationConfig }) {
  const provider = LLM_PROVIDER.toLowerCase();
  if (provider === "nvidia") return callNvidia({ system, contents, generationConfig });
  if (provider === "groq") return callGroq({ system, contents, responseMimeType, generationConfig });
  return callGemini({ system, contents, responseMimeType, generationConfig });
}

const ANALYZE_CACHE = new Map();
const EXPERIMENTS_CACHE = new Map();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export function cacheGet(key) {
  const hit = ANALYZE_CACHE.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > CACHE_TTL_MS) {
    ANALYZE_CACHE.delete(key);
    return null;
  }
  return hit.value;
}

export function cacheSet(key, value) {
  ANALYZE_CACHE.set(key, { ts: Date.now(), value });
}

export function expCacheGet(key) {
  const hit = EXPERIMENTS_CACHE.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > CACHE_TTL_MS) {
    EXPERIMENTS_CACHE.delete(key);
    return null;
  }
  return hit.value;
}

export function expCacheSet(key, value) {
  EXPERIMENTS_CACHE.set(key, { ts: Date.now(), value });
}

export function computeScoresFromAnswers(answers) {
  const a = Array.isArray(answers) ? answers.slice(0, 12).map((n) => Number(n) || 0) : [];
  const sum = (...idxs) => idxs.reduce((s, i) => s + (a[i] || 0), 0);

  const scores = {
    acceptance: sum(0, 3, 6),
    agency: sum(2, 4, 7),
    autonomy: sum(5, 8, 9),
    adaptability: sum(1, 10, 11)
  };

  const overallTotal = a.reduce((s, v) => s + (v || 0), 0);
  const overallAvg = overallTotal / 12;
  const trust_index_status =
    overallAvg <= 2.2 ? "Red Alert" : overallAvg <= 3.6 ? "Situational Doubt" : "Big Trust";

  const TIE_PRIORITY = ["Acceptance", "Agency", "Autonomy", "Adaptability"];
  const categories = [
    ["Acceptance", scores.acceptance],
    ["Agency", scores.agency],
    ["Autonomy", scores.autonomy],
    ["Adaptability", scores.adaptability]
  ].sort((x, y) => {
    if (x[1] !== y[1]) return x[1] - y[1];
    return TIE_PRIORITY.indexOf(x[0]) - TIE_PRIORITY.indexOf(y[0]);
  });

  const lowest_category = categories[0]?.[0] || "Acceptance";
  const profileMap = {
    Acceptance: "The Approval Seeker",
    Agency: "The Perfectionist",
    Autonomy: "The Passenger",
    Adaptability: "The Overthinker"
  };

  return {
    scores,
    overallAvg,
    trust_index_status,
    lowest_category,
    primary_profile: profileMap[lowest_category] || "The Approval Seeker"
  };
}

export function focusQuestionValues(answers, focusCategory) {
  const a = Array.isArray(answers) ? answers.slice(0, 12).map((n) => Number(n) || 0) : [];
  const map = {
    Acceptance: [0, 3, 6],
    Agency: [2, 4, 7],
    Autonomy: [5, 8, 9],
    Adaptability: [1, 10, 11]
  };
  const idxs = map[focusCategory] || map.Acceptance;
  const pairs = idxs.map((i) => ({ q: i + 1, v: a[i] || 0 }));
  pairs.sort((x, y) => x.v - y.v);
  return pairs;
}

export function enforceUniqueFocusExperiments(parsed) {
  const list = Array.isArray(parsed?.focus_experiments) ? parsed.focus_experiments : [];
  if (list.length !== 3) return false;
  const titles = list.map((e) => String(e?.title || "").trim().toLowerCase());
  const baseTitle = (t) => String(t || "").split("—")[0].trim();
  const bases = titles.map(baseTitle);
  return new Set(titles).size === 3 && new Set(bases).size === 3;
}

export function enforceUniqueExperiments(parsed) {
  const list = Array.isArray(parsed?.experiments) ? parsed.experiments : [];
  if (list.length !== 3) return false;
  const titles = list.map((e) => String(e?.title || "").trim().toLowerCase());
  const baseTitle = (t) => String(t || "").split("—")[0].trim();
  const bases = titles.map(baseTitle);
  return new Set(titles).size === 3 && new Set(bases).size === 3;
}

export const REFERENCE_NOTES = PODCAST_NOTES;

export function hashKey(obj) {
  return crypto.createHash("sha256").update(JSON.stringify(obj)).digest("hex");
}
