import {
  API_KEY,
  NVIDIA_API_KEY,
  GROQ_API_KEY,
  AI_ENABLED,
  AI_REPAIR_JSON,
  LLM_TIMEOUT_MS,
  LLM_PROVIDER,
  SYSTEM_PROMPT_ANALYZE,
  REFERENCE_NOTES,
  sendJson,
  readJson,
  tryParseJsonLoose,
  callLLM,
  cacheGet,
  cacheSet,
  computeScoresFromAnswers,
  focusQuestionValues,
  enforceUniqueFocusExperiments,
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
    const base = computeScoresFromAnswers(answers);
    const cacheKey = hashKey({ answers: answers.slice(0, 12), v: 6 });

    const cached = cacheGet(cacheKey);
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
      REFERENCE_NOTES
        ? "Reference notes (use to teach the lesson; do not quote long passages):\n" +
          REFERENCE_NOTES.slice(0, 900)
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
    if (parsed && !enforceUniqueFocusExperiments(parsed)) {
      parsed = null;
    }

    if (!parsed) {
      const { text: text2 } = await callLLM({
        system:
          "You output only valid JSON. No markdown. No extra keys. Use double quotes. No trailing commas.",
        contents: [{ role: "user", parts: [{ text: aiPrompt }] }],
        responseMimeType: "application/json",
        generationConfig: { temperature: 0.0, topK: 1, topP: 0.1, maxOutputTokens: 1900 }
      });
      lastText = text2;
      parsed = tryParseJsonLoose(text2);
      if (parsed && !enforceUniqueFocusExperiments(parsed)) {
        parsed = null;
      }
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

    const merged = {
      ...parsed,
      primary_profile: base.primary_profile,
      trust_index_status: base.trust_index_status,
      _meta: { mode: "ai", provider: LLM_PROVIDER }
    };
    cacheSet(cacheKey, merged);
    sendJson(res, 200, merged);
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
