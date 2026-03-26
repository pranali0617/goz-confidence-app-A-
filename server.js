import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envPath = path.join(__dirname, ".env");
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
        // Allow GEMINI_API_KEY="..." or '...'
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

const PORT = process.env.PORT || 8787;
const API_KEY = process.env.GEMINI_API_KEY || env.GEMINI_API_KEY;
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY || env.NVIDIA_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY || env.GROQ_API_KEY;
const SHEETS_WEBHOOK_URL = process.env.SHEETS_WEBHOOK_URL || env.SHEETS_WEBHOOK_URL;
const SHEETS_WEBHOOK_TOKEN = process.env.SHEETS_WEBHOOK_TOKEN || env.SHEETS_WEBHOOK_TOKEN;
const AI_ENABLED =
  (process.env.AI_ENABLED ?? env.AI_ENABLED ?? "1").toString().trim() !== "0";
const AI_REPAIR_JSON =
  (process.env.AI_REPAIR_JSON ?? env.AI_REPAIR_JSON ?? "1").toString().trim() !== "0";
const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS ?? env.LLM_TIMEOUT_MS ?? 45000);

const LLM_PROVIDER = (process.env.LLM_PROVIDER ?? env.LLM_PROVIDER ?? "gemini").toString().trim();
const GEMINI_MODEL = (process.env.GEMINI_MODEL ?? env.GEMINI_MODEL ?? "gemini-2.5-flash").toString().trim();
const NVIDIA_MODEL = (process.env.NVIDIA_MODEL ?? env.NVIDIA_MODEL ?? "qwen/qwen3.5-122b-a10b").toString().trim();
const GROQ_MODEL = (process.env.GROQ_MODEL ?? env.GROQ_MODEL ?? "llama-3.1-8b-instant").toString().trim();

const mimeTypes = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".json": "application/json"
};

const NOTES_PATH = path.join(__dirname, "knowledge", "jay_shetty_shade_summary.txt");
let PODCAST_NOTES = "";
try {
  if (fs.existsSync(NOTES_PATH)) {
    PODCAST_NOTES = fs.readFileSync(NOTES_PATH, "utf-8").trim();
  }
} catch {
  PODCAST_NOTES = "";
}

const SYSTEM_PROMPT_ANALYZE = [
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

const SYSTEM_PROMPT_EXPERIMENTS = [
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

const SYSTEM_PROMPT_CHAT = [
  "You are the Big Trust AI Coach (Dr. Shadé Zahrai’s Big Trust framework).",
  "Self-doubt is a misguided protector. We rewire confidence through tiny experiments.",
  "",
  "Use these categories and language when helpful: Acceptance (Self-Esteem), Agency (Self-Efficacy), Autonomy (Locus of Control), Adaptability (Emotional Stability).",
  "",
  "Rules:",
  "- Be concise and warm. Ask at most ONE question at a time.",
  "- Always end with one tiny next step (<= 10 minutes) that fits the user’s situation.",
  "- Prefer experiments from this library when relevant: Compliment Anchor, No-Explain Rule, 80% Draft, Skill Audit, Choice Reframe, Micro-Boundary, 5-5-5 Rule, Worry Window.",
  "- No citations. No bracketed tokens. No therapy claims."
].join("\n");

function send(res, status, data, type = "text/plain") {
  res.writeHead(status, {
    "Content-Type": type,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-goog-api-key"
  });
  res.end(data);
}

const ANALYZE_CACHE = new Map();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const EXPERIMENTS_CACHE = new Map();

function cacheGet(key) {
  const hit = ANALYZE_CACHE.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > CACHE_TTL_MS) {
    ANALYZE_CACHE.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(key, value) {
  ANALYZE_CACHE.set(key, { ts: Date.now(), value });
}

function expCacheGet(key) {
  const hit = EXPERIMENTS_CACHE.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > CACHE_TTL_MS) {
    EXPERIMENTS_CACHE.delete(key);
    return null;
  }
  return hit.value;
}

function expCacheSet(key, value) {
  EXPERIMENTS_CACHE.set(key, { ts: Date.now(), value });
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) req.destroy(); // basic protection
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch (err) {
        reject(err);
      }
    });
  });
}

function extractJsonFromText(text) {
  if (!text || typeof text !== "string") return null;
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) return null;
  const candidate = text.slice(first, last + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

function tryParseJsonLoose(text) {
  if (!text || typeof text !== "string") return null;
  // 1) Strip common code fences
  let t = text.trim();
  t = t.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();

  // 1b) Fix a common failure mode: raw newlines inside quoted strings (invalid JSON).
  // Gemini sometimes breaks `"Red Alert"` across lines as `"Red\nAlert"`, without escaping.
  const sanitizeNewlinesInStrings = (input) => {
    let out = "";
    let inString = false;
    let escaped = false;
    for (let i = 0; i < input.length; i += 1) {
      const ch = input[i];
      if (!inString) {
        if (ch === "\"") {
          inString = true;
          out += ch;
          continue;
        }
        out += ch;
        continue;
      }

      // in string
      if (escaped) {
        escaped = false;
        out += ch;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        out += ch;
        continue;
      }
      if (ch === "\"") {
        inString = false;
        out += ch;
        continue;
      }
      // Replace any line separators with spaces. JSON strings cannot contain raw newlines.
      if (ch === "\n" || ch === "\r" || ch === "\u2028" || ch === "\u2029") {
        out += " ";
        continue;
      }
      out += ch;
    }
    return out;
  };

  t = sanitizeNewlinesInStrings(t);

  // 2) Try direct parse
  try {
    return JSON.parse(t);
  } catch {
    // continue
  }

  // 3) Extract object region then attempt light cleanup
  const extracted = extractJsonFromText(t);
  if (extracted) return extracted;

  const first = t.indexOf("{");
  const last = t.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) return null;
  let candidate = t.slice(first, last + 1);

  // Normalize smart quotes
  candidate = candidate
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'");

  // Remove trailing commas: {"a":1,} or [1,]
  candidate = candidate.replace(/,\s*([}\]])/g, "$1");

  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

async function callGemini({ system, contents, responseMimeType, generationConfig }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  const requestBody = {
    // The Generative Language API supports a dedicated system instruction field.
    system_instruction: { parts: [{ text: system }] },
    contents,
    generationConfig: {
      temperature: 0.4,
      // Keep high enough to avoid truncated JSON responses.
      maxOutputTokens: 2500,
      ...(responseMimeType ? { responseMimeType } : {}),
      ...(generationConfig || {})
    }
  };

  let response;
  try {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": API_KEY
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      }
    );
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

    const apiError = parsedError?.error || {};
    const reason =
      apiError?.details?.find((d) => d?.reason)?.reason ||
      apiError?.status ||
      "GEMINI_API_ERROR";
    const message = apiError?.message || errorText || "Gemini API error";

    const err = new Error(message);
    err.reason = reason;
    err.status = apiError?.status;
    err.code = apiError?.code;
    // Extract suggested retry from error text (Gemini often includes "Please retry in Xs.")
    if (typeof message === "string") {
      const m = message.match(/retry in\s+([\d.]+)s/i);
      if (m?.[1]) {
        err.retryAfterMs = Math.ceil(Number(m[1]) * 1000);
      }
    }
    throw err;
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  return { text, raw: data };
}

async function callNvidia({ system, contents, generationConfig }) {
  if (!NVIDIA_API_KEY) {
    const err = new Error("Missing NVIDIA_API_KEY");
    err.reason = "MISSING_NVIDIA_API_KEY";
    err.code = 500;
    throw err;
  }
  const token = String(NVIDIA_API_KEY || "").trim();
  if (!token) {
    const err = new Error("Missing NVIDIA_API_KEY");
    err.reason = "MISSING_NVIDIA_API_KEY";
    err.code = 500;
    throw err;
  }

  // Convert our internal content array into a single user prompt.
  const userText =
    Array.isArray(contents) && contents.length
      ? contents
          .map((c) => c?.parts?.map((p) => p?.text || "").join("") || "")
          .join("\n")
          .trim()
      : "";

  const requestBody = {
    model: NVIDIA_MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: userText }
    ],
    // Keep outputs bounded; our prompts already enforce strict JSON.
    max_tokens: generationConfig?.maxOutputTokens ?? generationConfig?.max_tokens ?? 1600,
    temperature: generationConfig?.temperature ?? 0.0,
    top_p: generationConfig?.topP ?? generationConfig?.top_p ?? 0.2,
    stream: false,
    chat_template_kwargs: { enable_thinking: false }
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  let response;
  try {
    response = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        Accept: "application/json"
      },
      body: JSON.stringify(requestBody),
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
  if (!GROQ_API_KEY) {
    const err = new Error("Missing GROQ_API_KEY");
    err.reason = "MISSING_GROQ_API_KEY";
    err.code = 500;
    throw err;
  }
  const token = String(GROQ_API_KEY || "").trim();
  if (!token) {
    const err = new Error("Missing GROQ_API_KEY");
    err.reason = "MISSING_GROQ_API_KEY";
    err.code = 500;
    throw err;
  }

  // Convert our internal content array into a single user prompt.
  const userText =
    Array.isArray(contents) && contents.length
      ? contents
          .map((c) => c?.parts?.map((p) => p?.text || "").join("") || "")
          .join("\n")
          .trim()
      : "";

  const requestBody = {
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
    requestBody.response_format = { type: "json_object" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  let response;
  try {
    response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        Accept: "application/json"
      },
      body: JSON.stringify(requestBody),
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

async function callLLM({ system, contents, responseMimeType, generationConfig }) {
  const provider = LLM_PROVIDER.toLowerCase();
  if (provider === "nvidia") {
    return callNvidia({ system, contents, generationConfig });
  }
  if (provider === "groq") {
    return callGroq({ system, contents, responseMimeType, generationConfig });
  }
  return callGemini({ system, contents, responseMimeType, generationConfig });
}

function computeScoresFromAnswers(answers) {
  const a = Array.isArray(answers) ? answers.slice(0, 12).map((n) => Number(n) || 0) : [];
  const sum = (...idxs) => idxs.reduce((s, i) => s + (a[i] || 0), 0);

  const scores = {
    // Acceptance: Q1,Q4,Q7 -> 0,3,6
    acceptance: sum(0, 3, 6),
    // Agency: Q3,Q5,Q8 -> 2,4,7
    agency: sum(2, 4, 7),
    // Autonomy: Q6,Q9,Q10 -> 5,8,9
    autonomy: sum(5, 8, 9),
    // Adaptability: Q2,Q11,Q12 -> 1,10,11
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
    if (x[1] !== y[1]) return x[1] - y[1]; // lowest total = most doubt
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

function localExperimentLibrary() {
  return {
    Acceptance: [
      {
        title: "The Compliment Anchor",
        action:
          "Accept one piece of praise today with a simple “Thank you.” No explaining, no deflecting."
      },
      {
        title: "The No-Explain Rule",
        action:
          "Make 3 small choices today (food, order, outfit) and don’t explain your reasoning to anyone."
      }
    ],
    Agency: [
      {
        title: "The 80% Draft",
        action:
          "Finish one small task to 80% and stop. Submit/share it as-is to prove “done” is safe."
      },
      {
        title: "The Skill Audit",
        action: "List 3 skills you’ve improved in the last year and one proof/example for each."
      }
    ],
    Autonomy: [
      {
        title: "The Choice Reframe",
        action:
          "Once today, replace “I have to” with “I am choosing to” and add the reason (out loud or in notes)."
      },
      {
        title: "Micro-Boundary",
        action:
          "Say “No” to one small request, or move one meeting by 15 minutes to prove you own your time."
      }
    ],
    Adaptability: [
      {
        title: "The 5-5-5 Rule",
        action:
          "Ask: Will this matter in 5 minutes, 5 months, or 5 years? Then take one tiny action step."
      },
      {
        title: "The Worry Window",
        action:
          "Set a 10-minute timer to worry/write. When it ends, close the notebook and do one next action."
      }
    ]
  };
}

function buildLocalPlan(base, reason = "ai_disabled") {
  const lib = localExperimentLibrary();
  const redCat = base.lowest_category;
  const pick = (cat, i) => ({ category: cat, ...lib[cat][i % lib[cat].length] });
  const others = ["Acceptance", "Agency", "Autonomy", "Adaptability"].filter((c) => c !== redCat);

  return {
    scores: base.scores,
    primary_profile: base.primary_profile,
    trust_index_status: base.trust_index_status,
    psychological_insight:
      "Your answers point to a specific doubt pattern (not a personal flaw). Your brain is trying to keep you safe. We’ll rebuild self-trust with tiny experiments that create new evidence.",
    experiments: {
      red_alert: pick(redCat, 0),
      support_1: pick(others[0], 0),
      support_2: pick(others[1], 0),
      support_3: pick(others[2], 0)
    },
    seven_day_outlook:
      "After 7 days of tiny reps, you should feel quicker recovery from doubt and more follow-through on small actions.",
    _meta: { mode: "local", reason }
  };
}

// Note: We intentionally do NOT provide local coaching fallbacks.
// If AI is unavailable or returns invalid JSON, the app should surface a retry/error
// rather than silently substituting static content.

function serveStatic(req, res) {
  const urlObj = new URL(req.url, "http://localhost");
  const pathname = urlObj.pathname || "/";
  if (pathname === "/favicon.ico") {
    send(res, 204, "");
    return;
  }
  const urlPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.join(__dirname, urlPath);

  if (!filePath.startsWith(__dirname)) {
    send(res, 403, "Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      send(res, 404, "Not found");
      return;
    }
    const ext = path.extname(filePath);
    const type = mimeTypes[ext] || "application/octet-stream";
    send(res, 200, data, type);
  });
}

function focusQuestionValues(answers, focusCategory) {
  const a = Array.isArray(answers) ? answers.slice(0, 12).map((n) => Number(n) || 0) : [];
  const map = {
    Acceptance: [0, 3, 6], // Q1,Q4,Q7
    Agency: [2, 4, 7], // Q3,Q5,Q8
    Autonomy: [5, 8, 9], // Q6,Q9,Q10
    Adaptability: [1, 10, 11] // Q2,Q11,Q12
  };
  const idxs = map[focusCategory] || map.Acceptance;
  const pairs = idxs.map((i) => ({ q: i + 1, v: a[i] || 0 }));
  // Sort by lowest (most doubt) first so the LLM sees the real “driver”.
  pairs.sort((x, y) => x.v - y.v);
  return pairs;
}

async function handleAnalyze(req, res) {
  try {
    const payload = await readJson(req);
    const answers = payload.answers || [];
    const base = computeScoresFromAnswers(answers);
    const cacheKey = crypto
      .createHash("sha256")
      .update(JSON.stringify({ answers: answers.slice(0, 12), v: 5 }))
      .digest("hex");

    const cached = cacheGet(cacheKey);
    if (cached) {
      send(res, 200, JSON.stringify(cached), "application/json");
      return;
    }

    if (!AI_ENABLED) {
      send(
        res,
        503,
        JSON.stringify({ error: { message: "AI is disabled. Set AI_ENABLED=1 in .env and restart the server." } }),
        "application/json"
      );
      return;
    }
    if (LLM_PROVIDER.toLowerCase() === "nvidia") {
      if (!NVIDIA_API_KEY) {
        send(res, 500, JSON.stringify({ error: { message: "Missing NVIDIA_API_KEY" } }), "application/json");
        return;
      }
    } else if (LLM_PROVIDER.toLowerCase() === "groq") {
      if (!GROQ_API_KEY) {
        send(res, 500, JSON.stringify({ error: { message: "Missing GROQ_API_KEY" } }), "application/json");
        return;
      }
    } else {
      if (!API_KEY) {
        send(res, 500, JSON.stringify({ error: { message: "Missing GEMINI_API_KEY" } }), "application/json");
        return;
      }
    }

    const userLines = answers.slice(0, 12).map((v, i) => `Q${i + 1}: ${Number(v) || 0}`);

    const computedFocus = base.lowest_category;
    const computedTrust = base.trust_index_status;
    const computedProfile = base.primary_profile;
    const focusQs = focusQuestionValues(answers, computedFocus);

    const aiPrompt = [
      "Return STRICT JSON only. No markdown. Double quotes. No trailing commas. All strings single-line (no newline characters).",
      "Hard limits: psychological_insight <= 220 chars. lesson.points each <= 160 chars.",
      "Focus experiments limits: focus_experiments must be EXACTLY 3 items; each action<=90 chars; each why<=110 chars.",
      "Tone rule: If trust_index_status is Big Trust, write the insight like a high-performer doing maintenance (not like someone in crisis).",
      "",
      "Use these computed values EXACTLY (copy verbatim):",
      `primary_profile: ${computedProfile}`,
      `trust_index_status: ${computedTrust}`,
      `focus_category: ${computedFocus}`,
      `focus_question_values (most doubt first): ${focusQs.map((p) => `Q${p.q}=${p.v}`).join(", ")}`,
      "Lesson specificity rule:",
      "- If only ONE focus question is low (<=2) and the others are high (>=4), make the lesson about that exact symptom.",
      "  Example: If Q12=1 drives Adaptability, teach about 'brain won't switch off at rest' (open loops), not generic overthinking.",
      "",
      PODCAST_NOTES
        ? "Reference notes (use to teach the lesson; do not quote long passages):\n" +
          PODCAST_NOTES.slice(0, 900)
        : "",
      "",
      "Lesson rule (must follow):",
      "Write the lesson specifically for focus_category.",
      "lesson.title must be in this style: 'Why Your Brain ...' (example: 'Why Your Brain Deflects Praise').",
      "lesson.title MUST reference the focus area explicitly by using either the focus_category name or the primary_profile name.",
      "Avoid generic titles like 'Why Your Brain Overthinks' unless focus_category is Adaptability.",
      "If focus_category is not Adaptability, do NOT use the word 'overthink' in the lesson.",
      "lesson.points is exactly 3 items with this meaning:",
      "1) Point 1 (Mechanism): MUST start with 'The mechanism:' then 1 sentence in plain language.",
      "2) Point 2 (Why): MUST start with 'Why it developed:' then 1 sentence in plain language.",
      "3) Point 3 (Rewire): MUST start with 'How to rewire it:' then 1 sentence that names the focus experiment title.",
      "Tie specificity rule: If focus_category is Adaptability, align the mechanism to the lowest focus_question_values.",
      "- If Q12 is <=2, explicitly reference 'brain won't switch off at rest' or 'open loops'.",
      "- If Q11 is <=2, reference stress reactivity / coping load.",
      "- If Q2 is <=2, reference anxiety/irritability under pressure.",
      "Never put experiment names in square brackets. Do not use [brackets] anywhere in lesson.points.",
      "Write like a coach talking to this person. No generic statements. No jargon.",
      "Aim for the same feel as this example:",
      "Title: Why Your Brain Deflects Praise",
      "Point 1: The mechanism: When you dismiss a compliment, your brain logs it as proof you don't deserve it.",
      "Point 2: Why it developed: This pattern often starts early — praise felt conditional, so receiving it freely didn't feel safe.",
      "Point 3: How to rewire it: The Compliment Anchor trains you to receive without defending — each 'Thank you' is a proof point.",
      "",
      "Now also return focus_experiments: 3 tiny experiments for focus_category ONLY.",
      "You MUST include BOTH base titles for that category and ONE NEW title (not in base list).",
      "All 3 titles must be distinct. Do NOT repeat the same base title twice.",
      "- Acceptance: The Compliment Anchor; The No-Explain Rule.",
      "- Agency: The 80% Draft; The Skill Audit.",
      "- Autonomy: The Choice Reframe; Micro-Boundary.",
      "- Adaptability: The 5-5-5 Rule; The Worry Window.",
      "Each focus experiment is {title, action, why}. Keep each action <= 10 minutes. Why is 1 sentence, plain language.",
      "Return exactly: { psychological_insight, lesson:{title,points[3]} }",
      "And include focus_experiments as a top-level key as described above.",
      "",
      "Answers:",
      userLines.join("\n")
    ].filter(Boolean).join("\n");

    let lastText = "";
    const { text } = await callLLM({
      system: SYSTEM_PROMPT_ANALYZE,
      contents: [{ role: "user", parts: [{ text: aiPrompt }] }],
      responseMimeType: "application/json",
      generationConfig: { temperature: 0.0, topK: 1, topP: 0.1, maxOutputTokens: 1700 }
    });
    lastText = text;

    let parsed = tryParseJsonLoose(text);
    const enforceUnique = (payload) => {
      const list = Array.isArray(payload?.experiments) ? payload.experiments : [];
      if (list.length < 3) return false;
      const titles = list.map((e) => String(e?.title || "").trim().toLowerCase());
      const baseTitle = (t) => String(t || "").split("—")[0].trim();
      const bases = titles.map(baseTitle);
      const uniqueTitles = new Set(titles);
      const uniqueBases = new Set(bases);
      return uniqueTitles.size === 3 && uniqueBases.size === 3;
    };

    if (parsed && !enforceUnique(parsed)) {
      parsed = null;
    }
    if (!parsed) {
      // One cheap retry to reduce "AI couldn’t analyze" occurrences.
      const { text: text2 } = await callLLM({
        system:
          "You output only valid JSON. No markdown. No extra keys. Use double quotes. No trailing commas.",
        contents: [{ role: "user", parts: [{ text: aiPrompt }] }],
        responseMimeType: "application/json",
        generationConfig: { temperature: 0.0, topK: 1, topP: 0.1, maxOutputTokens: 1900 }
      });
      lastText = text2;
      parsed = tryParseJsonLoose(text2);
    }

    if (!parsed && AI_REPAIR_JSON) {
      // Low-token repair: convert the model output into valid JSON without changing meaning.
      const repairPrompt = [
        "Fix the following into valid JSON ONLY (no markdown, no comments).",
        "Preserve meaning and keys. Remove trailing commas. Replace newlines in strings with spaces.",
        "",
        "TEXT:",
        String(lastText || "").slice(0, 6000)
      ].join("\n");
      const { text: fixed } = await callLLM({
        system: "You output only valid JSON. No markdown.",
        contents: [{ role: "user", parts: [{ text: repairPrompt }] }],
        responseMimeType: "application/json",
        generationConfig: { temperature: 0.0, maxOutputTokens: 700 }
      });
      lastText = fixed;
      parsed = tryParseJsonLoose(fixed);
    }

    if (!parsed) {
      send(
        res,
        502,
        JSON.stringify({
          error: {
            message: "Gemini response was not valid JSON.",
            raw_sample: String(lastText || "").slice(0, 1400)
          }
        }),
        "application/json"
      );
      return;
    }

    const merged = {
      ...parsed,
      primary_profile: base.primary_profile,
      trust_index_status: base.trust_index_status,
      _meta: { mode: "ai", provider: LLM_PROVIDER }
    };
    cacheSet(cacheKey, merged);
    send(res, 200, JSON.stringify(merged), "application/json");
  } catch (error) {
    if (error?.reason === "LLM_TIMEOUT" || error?.code === 504) {
      send(
        res,
        504,
        JSON.stringify({
          error: {
            message: `AI is taking longer than usual. Please try again in a moment.`,
            reason: "LLM_TIMEOUT",
            timeout_ms: LLM_TIMEOUT_MS
          }
        }),
        "application/json"
      );
      return;
    }
    if (error?.reason === "RESOURCE_EXHAUSTED" || error?.code === 429) {
      send(
        res,
        429,
        JSON.stringify({
          error: {
            message: error.message || "Rate limit exceeded. Please retry shortly.",
            reason: error.reason || "RESOURCE_EXHAUSTED",
            retry_after_ms: error.retryAfterMs || 60000
          }
        }),
        "application/json"
      );
      return;
    }
    send(
      res,
      500,
      JSON.stringify({
        error: {
          message: error.message || "Server error",
          reason: error.reason || "SERVER_ERROR",
          code: error.code
        }
      }),
      "application/json"
    );
  }
}

async function handleExperiments(req, res) {
  try {
    const payload = await readJson(req);
    const answers = payload.answers || [];
    const category = String(payload.category || "").trim();
    const allowedCategories = new Set(["Acceptance", "Agency", "Autonomy", "Adaptability"]);
    if (!allowedCategories.has(category)) {
      send(res, 400, JSON.stringify({ error: { message: "Invalid category" } }), "application/json");
      return;
    }

    const base = computeScoresFromAnswers(answers);
    const cacheKey = crypto
      .createHash("sha256")
      .update(JSON.stringify({ answers: answers.slice(0, 12), category, v: 2 }))
      .digest("hex");

    const cached = expCacheGet(cacheKey);
    if (cached) {
      send(res, 200, JSON.stringify(cached), "application/json");
      return;
    }

    if (!AI_ENABLED) {
      send(
        res,
        503,
        JSON.stringify({ error: { message: "AI is disabled. Set AI_ENABLED=1 in .env and restart the server." } }),
        "application/json"
      );
      return;
    }
    if (LLM_PROVIDER.toLowerCase() === "nvidia") {
      if (!NVIDIA_API_KEY) {
        send(res, 500, JSON.stringify({ error: { message: "Missing NVIDIA_API_KEY" } }), "application/json");
        return;
      }
    } else if (LLM_PROVIDER.toLowerCase() === "groq") {
      if (!GROQ_API_KEY) {
        send(res, 500, JSON.stringify({ error: { message: "Missing GROQ_API_KEY" } }), "application/json");
        return;
      }
    } else {
      if (!API_KEY) {
        send(res, 500, JSON.stringify({ error: { message: "Missing GEMINI_API_KEY" } }), "application/json");
        return;
      }
    }

    const focus = base.lowest_category;
    const overallAvg = base.overallAvg;

    const allowed = {
      Acceptance: ["The Compliment Anchor", "The No-Explain Rule"],
      Agency: ["The 80% Draft", "The Skill Audit"],
      Autonomy: ["The Choice Reframe", "Micro-Boundary"],
      Adaptability: ["The 5-5-5 Rule", "The Worry Window"]
    };

    const prompts = [
      "Return STRICT JSON only. No markdown. Double quotes. No trailing commas. All strings single-line.",
      "Hard limits: title <= 40 chars. action <= 100 chars. why <= 110 chars.",
      "",
      `User scores: trust_index_status=${base.trust_index_status}; primary_profile=${base.primary_profile}; focus_category=${focus}; overall_avg=${overallAvg.toFixed(2)}.`,
      `Target category: ${category}.`,
      "",
      "Return EXACTLY 3 experiments. Each must be MEANINGFULLY DIFFERENT:",
      "- Experiment 1: solo, internal (done alone in your head or on paper)",
      "- Experiment 2: interpersonal (involves one other person or a social moment)",
      "- Experiment 3: behavioral (a visible action or choice you make today)",
      "",
      "Required titles:",
      `- Include BOTH base titles for ${category}: ${allowed[category].join("; ")}.`,
      "- Create ONE NEW title (not in the base list).",
      "- All 3 titles must be distinct. Do NOT use the same base title twice.",
      "- Do NOT use 'Quick' variants.",
      "",
      "Each experiment must:",
      "- Have a specific trigger (e.g. 'The next time you...', 'Before your next...')",
      "- Be doable in <= 10 minutes",
      "- Have a 'why' that explains what this rewires in plain language",
      "",
      `If trust_index_status is Big Trust and ${category} is NOT the focus_category, frame as a maintenance rep.`,
      `If ${category} IS the focus_category (${focus}), make experiment[0] the highest-leverage one for the specific doubt pattern.`,
      "",
      "Variety check before responding: Are all 3 actions genuinely different? If two feel similar, replace one.",
      "",
      "Return exactly: { category, experiments:[{title,action,why},{title,action,why},{title,action,why}] }",
      "",
      "Answers (1..5):",
      answers.slice(0, 12).map((v, i) => `Q${i + 1}: ${Number(v) || 0}`).join("\n")
    ].join("\n");

    let lastText = "";
    const { text } = await callLLM({
      system: SYSTEM_PROMPT_EXPERIMENTS,
      contents: [{ role: "user", parts: [{ text: prompts }] }],
      responseMimeType: "application/json",
      generationConfig: { temperature: 0.0, maxOutputTokens: 900 }
    });
    lastText = text;

    let parsed = tryParseJsonLoose(text);
    if (!parsed && AI_REPAIR_JSON) {
      // Low-token repair: "convert to valid JSON" without changing meaning.
      const repairPrompt = [
        "Fix the following into valid JSON ONLY (no markdown, no comments).",
        "Preserve meaning and keys. Remove any trailing commas. Replace newlines in strings with spaces.",
        "",
        "TEXT:",
        String(lastText || "").slice(0, 6000)
      ].join("\n");
      const { text: fixed } = await callLLM({
        system: "You output only valid JSON. No markdown.",
        contents: [{ role: "user", parts: [{ text: repairPrompt }] }],
        responseMimeType: "application/json",
        generationConfig: { temperature: 0.0, maxOutputTokens: 700 }
      });
      lastText = fixed;
      parsed = tryParseJsonLoose(fixed);
    }

    if (!parsed) {
      send(
        res,
        502,
        JSON.stringify({
          error: {
            message: "Gemini response was not valid JSON.",
            raw_sample: String(lastText || "").slice(0, 1200)
          }
        }),
        "application/json"
      );
      return;
    }

    const normalized = {
      category,
      experiments: Array.isArray(parsed?.experiments) ? parsed.experiments.slice(0, 3) : [],
      _meta: { mode: "ai" }
    };
    expCacheSet(cacheKey, normalized);
    send(res, 200, JSON.stringify(normalized), "application/json");
  } catch (error) {
    if (error?.reason === "LLM_TIMEOUT" || error?.code === 504) {
      send(
        res,
        504,
        JSON.stringify({
          error: {
            message: `AI is taking longer than usual. Please try again in a moment.`,
            reason: "LLM_TIMEOUT",
            timeout_ms: LLM_TIMEOUT_MS
          }
        }),
        "application/json"
      );
      return;
    }
    if (error?.reason === "RESOURCE_EXHAUSTED" || error?.code === 429) {
      send(
        res,
        429,
        JSON.stringify({
          error: {
            message: error.message || "Rate limit exceeded. Please retry shortly.",
            reason: error.reason || "RESOURCE_EXHAUSTED",
            retry_after_ms: error.retryAfterMs || 60000
          }
        }),
        "application/json"
      );
      return;
    }
    send(
      res,
      500,
      JSON.stringify({
        error: {
          message: error.message || "Server error",
          reason: error.reason || "SERVER_ERROR",
          code: error.code
        }
      }),
      "application/json"
    );
  }
}

async function handleChat(req, res) {
  const provider = LLM_PROVIDER.toLowerCase();
  const missingKey =
    provider === "nvidia"
      ? !NVIDIA_API_KEY
      : provider === "groq"
        ? !GROQ_API_KEY
        : !API_KEY;
  if (!AI_ENABLED || missingKey) {
    send(
      res,
      200,
      JSON.stringify({ reply: "AI is currently off to save API key usage. Turn it back on when you’re ready." }),
      "application/json"
    );
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
      ? `User context (do not repeat verbatim):\n${JSON.stringify(context).slice(0, 12_000)}`
      : "No survey context available.";

    const { text } = await callLLM({
      system: `${SYSTEM_PROMPT_CHAT}\n\n${contextBlob}`,
      contents
    });

    send(res, 200, JSON.stringify({ reply: text }), "application/json");
  } catch (error) {
    if (error?.reason === "LLM_TIMEOUT" || error?.code === 504) {
      send(
        res,
        504,
        JSON.stringify({
          error: {
            message: `AI is taking longer than usual. Please try again in a moment.`,
            reason: "LLM_TIMEOUT",
            timeout_ms: LLM_TIMEOUT_MS
          }
        }),
        "application/json"
      );
      return;
    }
    if (error?.reason === "RESOURCE_EXHAUSTED" || error?.code === 429) {
      send(
        res,
        429,
        JSON.stringify({
          error: {
            message: error.message || "Rate limit exceeded. Please retry shortly.",
            reason: error.reason || "RESOURCE_EXHAUSTED",
            retry_after_ms: error.retryAfterMs || 60000
          }
        }),
        "application/json"
      );
      return;
    }
    send(
      res,
      500,
      JSON.stringify({
        error: {
          message: error.message || "Server error",
          reason: error.reason || "SERVER_ERROR",
          code: error.code
        }
      }),
      "application/json"
    );
  }
}

async function handleTrack(req, res) {
  try {
    if (!SHEETS_WEBHOOK_URL) {
      send(
        res,
        500,
        JSON.stringify({
          error: {
            message:
              "Missing SHEETS_WEBHOOK_URL. Create a Google Apps Script webhook and set SHEETS_WEBHOOK_URL in .env."
          }
        }),
        "application/json"
      );
      return;
    }

    const payload = await readJson(req);
    const body = JSON.stringify(payload || {});

    const headers = { "Content-Type": "application/json" };
    // Support both header- and query-param based webhook auth.
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
        send(res, 504, JSON.stringify({ error: { message: "Sheets webhook timeout." } }), "application/json");
        return;
      }
      throw e;
    } finally {
      clearTimeout(timeout);
    }

    if (!resp.ok) {
      const txt = await resp.text();
      send(
        res,
        502,
        JSON.stringify({ error: { message: "Sheets webhook error", detail: txt.slice(0, 800) } }),
        "application/json"
      );
      return;
    }

    const ct = (resp.headers.get("content-type") || "").toLowerCase();
    const txt = await resp.text();
    // Some Apps Script deployments return HTML on auth/permission issues while still 200.
    if (ct.includes("application/json")) {
      let parsed = null;
      try {
        parsed = JSON.parse(txt || "{}");
      } catch {
        parsed = null;
      }
      if (parsed?.ok === true) {
        send(res, 200, JSON.stringify({ ok: true }), "application/json");
        return;
      }
      send(
        res,
        502,
        JSON.stringify({
          error: {
            message: "Sheets webhook did not confirm ok:true",
            detail: JSON.stringify(parsed || {}).slice(0, 800)
          }
        }),
        "application/json"
      );
      return;
    }

    send(
      res,
      502,
      JSON.stringify({
        error: {
          message: "Sheets webhook returned non-JSON (likely auth/permissions).",
          detail: String(txt || "").slice(0, 800)
        }
      }),
      "application/json"
    );
  } catch (error) {
    send(
      res,
      500,
      JSON.stringify({ error: { message: error.message || "Server error" } }),
      "application/json"
    );
  }
}

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    send(res, 204, "");
    return;
  }

  if (req.method == "POST" && req.url == "/api/analyze") {
    handleAnalyze(req, res);
    return;
  }

  if (req.method == "POST" && req.url == "/api/experiments") {
    handleExperiments(req, res);
    return;
  }

  if (req.method == "POST" && req.url == "/api/chat") {
    handleChat(req, res);
    return;
  }

  if (req.method == "POST" && req.url == "/api/track") {
    handleTrack(req, res);
    return;
  }

  if (req.method == "GET") {
    serveStatic(req, res);
    return;
  }

  send(res, 405, "Method Not Allowed");
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Confidence Atlas server running on http://localhost:${PORT}`);
});
