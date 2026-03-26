import {
  API_KEY,
  NVIDIA_API_KEY,
  GROQ_API_KEY,
  AI_ENABLED,
  AI_REPAIR_JSON,
  LLM_TIMEOUT_MS,
  LLM_PROVIDER,
  SYSTEM_PROMPT_EXPERIMENTS,
  sendJson,
  readJson,
  tryParseJsonLoose,
  callLLM,
  expCacheGet,
  expCacheSet,
  computeScoresFromAnswers,
  enforceUniqueExperiments,
  hashKey
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
    const payload = await readJson(req);
    const answers = payload.answers || [];
    const category = String(payload.category || "").trim();
    const allowedCategories = new Set(["Acceptance", "Agency", "Autonomy", "Adaptability"]);
    if (!allowedCategories.has(category)) {
      sendJson(res, 400, { error: { message: "Invalid category" } });
      return;
    }

    const base = computeScoresFromAnswers(answers);
    const cacheKey = hashKey({ answers: answers.slice(0, 12), category, v: 3 });

    const cached = expCacheGet(cacheKey);
    if (cached) {
      sendJson(res, 200, cached);
      return;
    }

    if (!AI_ENABLED) {
      sendJson(res, 503, { error: { message: "AI is disabled. Set AI_ENABLED=1 in .env and restart the server." } });
      return;
    }

    if (LLM_PROVIDER.toLowerCase() === "nvidia") {
      if (!NVIDIA_API_KEY) {
        sendJson(res, 500, { error: { message: "Missing NVIDIA_API_KEY" } });
        return;
      }
    } else if (LLM_PROVIDER.toLowerCase() === "groq") {
      if (!GROQ_API_KEY) {
        sendJson(res, 500, { error: { message: "Missing GROQ_API_KEY" } });
        return;
      }
    } else {
      if (!API_KEY) {
        sendJson(res, 500, { error: { message: "Missing GEMINI_API_KEY" } });
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
    if (parsed && !enforceUniqueExperiments(parsed)) {
      parsed = null;
    }

    if (!parsed && AI_REPAIR_JSON) {
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
      sendJson(res, 502, {
        error: {
          message: "LLM response was not valid JSON.",
          raw_sample: String(lastText || "").slice(0, 1400)
        }
      });
      return;
    }

    const normalized = {
      category,
      experiments: Array.isArray(parsed.experiments) ? parsed.experiments : []
    };
    expCacheSet(cacheKey, normalized);
    sendJson(res, 200, normalized);
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
