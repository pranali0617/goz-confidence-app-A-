const QUESTIONS = [
  "I often feel inadequate compared to others, as if they are somehow more worthy.",
  "I often feel highly stressed, irritable, or anxious.",
  "Deep down, I worry that people overestimate my abilities.",
  "I find myself seeking approval from others to validate my worth and decisions.",
  "I often feel like other people know what they are doing, and I am just trying to keep up.",
  "I often feel that I do not have control over my life.",
  "I set standards that are impossibly high, and then, when I fail to meet them, take it personally and become self-critical.",
  "I often question or second-guess my own competence or skills, unsure if I am truly capable.",
  "Whether or not I succeed mostly depends on who I know, not what I do.",
  "I often feel like my career is out of my hands, and it leaves me feeling stuck or powerless.",
  "I struggle to cope with personal or work problems - they stress me out a lot.",
  "Even when I try to relax, my brain will not switch off - it is busy overthinking or worrying about what might go wrong."
];

const OPTIONS = [
  // Scale matches the system prompt: 1 (Strongly Agree) .. 5 (Strongly Disagree).
  { label: "Strongly Agree", value: 1 },
  { label: "Agree", value: 2 },
  { label: "Neutral", value: 3 },
  { label: "Disagree", value: 4 },
  { label: "Strongly Disagree", value: 5 }
];

const DRIVERS = {
  // Mapping per updated Big Trust prompt (1-based Q numbers):
  // Acceptance: Q1, Q4, Q7 -> 0,3,6
  // Agency: Q3, Q5, Q8 -> 2,4,7
  // Autonomy: Q6, Q9, Q10 -> 5,8,9
  // Adaptability: Q2, Q11, Q12 -> 1,10,11
  Acceptance: [0, 3, 6],
  Agency: [2, 4, 7],
  Autonomy: [5, 8, 9],
  Adaptability: [1, 10, 11]
};

// Experiments are AI-generated; avoid static coaching copy in the UI.

const STORAGE_KEY = "confidence-atlas";

const heroPanel = document.getElementById("hero-panel");
const surveyPanel = document.getElementById("survey-panel");
const resultsPanel = document.getElementById("results-panel");

const beginBtn = document.getElementById("begin-btn");
const surveyQuestion = document.getElementById("survey-question");
const surveyOptions = document.getElementById("survey-options");
const surveyCount = document.getElementById("survey-count");
const surveyBack = document.getElementById("survey-back");
const surveyExit = document.getElementById("survey-exit");

const indexPill = document.getElementById("index-pill");
const indexSubtitle = document.getElementById("index-subtitle");
const indexFill = document.getElementById("index-fill");
const llmStatus = document.getElementById("llm-status");
const barsEl = document.getElementById("bars");
const scoreChips = document.getElementById("score-chips");
const step1El = document.getElementById("step-1");
const step2El = document.getElementById("step-2");
const step3El = document.getElementById("step-3");
const step1Next = document.getElementById("step1-next");
const step2Back = document.getElementById("step2-back");
const step2Next = document.getElementById("step2-next");
const step3Back = document.getElementById("step3-back");
const stepsLabel = document.getElementById("steps-label");
const dot1 = document.getElementById("dot-1");
const dot2 = document.getElementById("dot-2");
const dot3 = document.getElementById("dot-3");
const lessonTitle = document.getElementById("lesson-title");
const lessonBody = document.getElementById("lesson-body");
const lessonCards = document.getElementById("lesson-cards");
const lessonNext = document.getElementById("lesson-next");
const redAlertBlock = document.getElementById("red-alert-block");
const focusHeading = document.getElementById("focus-heading");
const redAlertProfile = document.getElementById("red-alert-profile");
const redAlertImpact = document.getElementById("red-alert-impact");
const focusWhy = document.getElementById("focus-why");
const focusLoading = document.getElementById("focus-loading");
const catCards = document.getElementById("cat-cards");
const expModal = document.getElementById("exp-modal");
const expModalBackdrop = document.getElementById("exp-modal-backdrop");
const expModalClose = document.getElementById("exp-modal-close");
const expModalTitle = document.getElementById("exp-modal-title");
const expModalKicker = document.getElementById("exp-modal-kicker");
const expList = document.getElementById("exp-list");
const expSaveStatus = document.getElementById("exp-save-status");
const restartBtn = document.getElementById("restart-btn");
const debugBlock = document.getElementById("debug-block");
const debugRaw = document.getElementById("debug-raw");
const chatLog = document.getElementById("chat-log");
const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");
const chatStatus = document.getElementById("chat-status");
const API_URL = "/api/analyze";
const EXP_URL = "/api/experiments";
const CHAT_URL = "/api/chat";
const TRACK_URL = "/api/track";

const state = {
  responses: Array(QUESTIONS.length).fill(null),
  report: null,
  experiments: {},
  chat: {
    messages: []
  },
  ui: {
    resultsStep: 1,
    selectedCategory: null,
    expIndex: 0
  }
};

let currentQuestion = 0;
let currentResultsStep = 1;

async function fetchWithTimeout(url, options = {}, timeoutMs = 45000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } catch (e) {
    if (e?.name === "AbortError") {
      throw new Error(`AI timeout. Please try again.\nreason=LLM_TIMEOUT`);
    }
    throw e;
  } finally {
    clearTimeout(id);
  }
}

function showPanel(panel) {
  [heroPanel, surveyPanel, resultsPanel].forEach((section) => section.classList.add("hidden"));
  panel.classList.remove("hidden");
}

function setDots(step) {
  if (!dot1 || !dot2 || !dot3) return;
  [dot1, dot2, dot3].forEach((d) => d.classList.remove("is-active"));
  if (step === 1) dot1.classList.add("is-active");
  if (step === 2) dot2.classList.add("is-active");
  if (step === 3) dot3.classList.add("is-active");
}

function setStepLabel(step) {
  if (!stepsLabel) return;
  stepsLabel.textContent = step === 1 ? "Snapshot" : step === 2 ? "Learn" : "Practice";
}

function showResultsStep(step) {
  const steps = [step1El, step2El, step3El].filter(Boolean);
  if (!steps.length) return;
  const next = step === 1 ? step1El : step === 2 ? step2El : step3El;
  const current =
    currentResultsStep === 1
      ? step1El
      : currentResultsStep === 2
        ? step2El
        : step3El;
  if (!next || !current) return;
  if (next === current) return;

  // Ensure only one step is visible.
  steps.forEach((el) => el.classList.add("hidden"));

  // animate out current, then swap
  current.classList.remove("step-in");
  current.classList.add("step-out");
  setTimeout(() => {
    current.classList.remove("step-out");
    next.classList.remove("hidden");
    next.classList.add("step-in");
    // Keep the transition feeling snappy by returning to the top each step.
    try {
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      window.scrollTo(0, 0);
    }
    setTimeout(() => next.classList.remove("step-in"), 360);
  }, 230);

  currentResultsStep = step;
  state.ui.resultsStep = step;
  setDots(step);
  setStepLabel(step);
  saveState();
}

function resetResultsSteps() {
  if (step1El) step1El.classList.remove("hidden");
  if (step2El) step2El.classList.add("hidden");
  if (step3El) step3El.classList.add("hidden");
  currentResultsStep = 1;
  state.ui.resultsStep = 1;
  setDots(1);
  setStepLabel(1);
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return;
  try {
    Object.assign(state, JSON.parse(saved));
  } catch (error) {
    console.warn("Failed to parse saved state", error);
  }
}

function renderQuestion() {
  surveyQuestion.textContent = QUESTIONS[currentQuestion];
  surveyCount.textContent = `${currentQuestion + 1} / ${QUESTIONS.length}`;

  surveyOptions.innerHTML = "";
  OPTIONS.forEach((option, index) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "option";
    btn.innerHTML = `<strong>${String.fromCharCode(65 + index)}</strong> ${option.label}`;
    if (state.responses[currentQuestion] === option.value) {
      btn.classList.add("selected");
    }
    btn.addEventListener("click", () => {
      state.responses[currentQuestion] = option.value;
      [...surveyOptions.children].forEach((child) => child.classList.remove("selected"));
      btn.classList.add("selected");
      window.requestAnimationFrame(() => {
        btn.scrollIntoView({ block: "nearest" });
      });
      setTimeout(() => {
        if (currentQuestion === QUESTIONS.length - 1) {
          finishSurvey();
          return;
        }
        currentQuestion += 1;
        renderQuestion();
        saveState();
      }, 520);
    });
    surveyOptions.appendChild(btn);
  });

  surveyBack.disabled = currentQuestion === 0;
}

function scoreDrivers() {
  const totals = {};
  const avgs = {};
  Object.entries(DRIVERS).forEach(([driver, indexes]) => {
    const total = indexes.reduce((sum, idx) => sum + (state.responses[idx] || 0), 0);
    totals[driver] = total;
    avgs[driver] = total / indexes.length;
  });

  const overallTotal = Object.values(totals).reduce((a, b) => a + b, 0);
  const overallAvg = overallTotal / QUESTIONS.length;

  return { totals, avgs, overallAvg };
}

function classifyBigTrust(overallAvg) {
  // 1..5 where lower = more doubt.
  if (overallAvg <= 2.2) return { level: "Red Alert", one_liner: "Your doubt is loud right now. We'll build trust with micro-wins." };
  if (overallAvg <= 3.6) return { level: "Situational Doubt", one_liner: "Your confidence shifts with context. We'll stabilize it with a simple circuit." };
  return { level: "Big Trust", one_liner: "You have strong self-trust. We'll keep sharpening it with small reps." };
}

function primaryProfileFromTotals(totals) {
  const entries = Object.entries(totals);
  entries.sort((a, b) => a[1] - b[1]); // lowest total = most doubt
  const driver = entries[0]?.[0] || "Acceptance";
  const map = {
    Acceptance: "The Approval Seeker",
    Agency: "The Perfectionist",
    Autonomy: "The Passenger",
    Adaptability: "The Overthinker"
  };
  return { driver, profile: map[driver] || "The Approval Seeker" };
}

function defaultCircuit() {
  return {
    acceptance: { title: "The Compliment Anchor", action: "Accept one piece of praise with a simple \"Thank you\" (no explaining it away)." },
    agency: { title: "The 80% Draft", action: "Complete a minor task to 80% and stop there to prove \"done\" is safe." },
    autonomy: { title: "The Choice Reframe", action: "Replace \"I have to\" with \"I am choosing to\" once today to reclaim power." },
    adaptability: { title: "The 5-5-5 Rule", action: "Ask: Will this matter in 5 minutes, 5 months, or 5 years? Then take one tiny step." }
  };
}

function driverColor(driver) {
  if (driver === "Acceptance") return "#0e2a74";
  if (driver === "Agency") return "#3f8fe6";
  if (driver === "Autonomy") return "#6ecfd0";
  return "#ff864a"; // Adaptability
}

function renderDriverBars(avgs) {
  barsEl.innerHTML = "";
  const order = ["Acceptance", "Agency", "Autonomy", "Adaptability"];
  order.forEach((driver) => {
    const avg = avgs[driver] || 1;
    const heightPct = Math.max(5, Math.min(100, ((avg - 1) / 4) * 100));
    const bar = document.createElement("div");
    bar.className = "bar";
    const fill = document.createElement("div");
    fill.className = "bar-fill";
    fill.style.height = `${heightPct}%`;
    fill.style.background = driverColor(driver);
    const label = document.createElement("div");
    label.className = "bar-label";
    const band =
      avg <= 2 ? "Red Alert" :
      avg <= 2.8 ? "Hindrance" :
      avg <= 3.6 ? "So-So" :
      avg <= 4.3 ? "Hidden Strength" :
      "Superpower";
    label.innerHTML = `${driver}<small>${band}</small>`;
    bar.appendChild(fill);
    bar.appendChild(label);
    barsEl.appendChild(bar);
  });
}

function renderScoreChips(totals, overallAvg) {
  if (!scoreChips) return;
  scoreChips.innerHTML = "";
  const overallChip = document.createElement("span");
  overallChip.className = "chip";
  overallChip.textContent = `Overall: ${overallAvg.toFixed(1)}/5`;
  scoreChips.appendChild(overallChip);
}

function renderResults() {
  const { totals, avgs, overallAvg } = scoreDrivers();
  const trust = classifyBigTrust(overallAvg);
  indexPill.textContent = trust.level;
  indexSubtitle.textContent = trust.one_liner;
  indexFill.style.width = `${Math.round(((overallAvg - 1) / 4) * 100)}%`;
  renderDriverBars(avgs);
  renderScoreChips(totals, overallAvg);
}

async function analyzeWithLLM() {
  const { totals, avgs, overallAvg } = scoreDrivers();
  const response = await fetchWithTimeout(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      questions: QUESTIONS,
      answers: state.responses,
      scale: {
        1: "Strongly Agree",
        2: "Agree",
        3: "Neutral",
        4: "Disagree",
        5: "Strongly Disagree"
      },
      driver_mapping: DRIVERS,
      driver_totals: totals,
      driver_averages: avgs,
      overall_average: overallAvg
    })
  }, 45000);

  if (!response.ok) {
    let bodyText = await response.text();
    let message = bodyText;
    try {
      const parsed = JSON.parse(bodyText);
      message = parsed?.error?.message || message;
      if (parsed?.error?.retry_after_ms) {
        message = `${message}\nretry_after_ms=${parsed.error.retry_after_ms}`;
      }
      if (parsed?.error?.raw_sample) {
        message = `${message}\n\nRaw sample:\n${parsed.error.raw_sample}`;
      }
    } catch {
      // ignore
    }
    throw new Error(message);
  }

  return response.json();
}

async function fetchExperiments(category) {
  const key = String(category || "");
  if (state.experiments?.[key]) return state.experiments[key];

  const response = await fetchWithTimeout(EXP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ category: key, answers: state.responses })
  }, 45000);

  if (!response.ok) {
    let bodyText = await response.text();
    let message = bodyText;
    try {
      const parsed = JSON.parse(bodyText);
      message = parsed?.error?.message || message;
      if (parsed?.error?.retry_after_ms) {
        message = `${message}\nretry_after_ms=${parsed.error.retry_after_ms}`;
      }
      if (parsed?.error?.raw_sample) {
        message = `${message}\n\nRaw sample:\n${parsed.error.raw_sample}`;
      }
    } catch {
      // ignore
    }
    throw new Error(message);
  }

  const data = await response.json();
  state.experiments[key] = data;
  saveState();
  return data;
}

function toSentences(text) {
  if (!text) return "";
  return String(text).replace(/\s+/g, " ").trim();
}

// (Left intentionally small) We keep text normalization here so AI strings render cleanly.

function applyLLMReport(report) {
  state.report = report;
  debugBlock?.classList.add("hidden");
  resetResultsSteps();
  if (!state.experiments) state.experiments = {};
  state.ui.selectedCategory = null;
  state.ui.expIndex = 0;
  if (expSaveStatus) expSaveStatus.textContent = "";

  const { totals, overallAvg } = scoreDrivers();
  const computedTrust = classifyBigTrust(overallAvg);
  const primary = primaryProfileFromTotals(totals);

  // Trust index shown in UI is computed from the user's answers so it never "sticks" to Red Alert.
  const trustLevel = computedTrust.level;
  const trustOneLiner = report?.psychological_insight || computedTrust.one_liner;
  indexPill.textContent = trustLevel;
  indexSubtitle.textContent = trustOneLiner;
  renderScoreChips(totals, overallAvg);

  redAlertProfile.textContent = report?.primary_profile || primary.profile;
  const focusImpact =
    report?.psychological_insight ||
    "This is your lowest-scoring driver right now, so it’s the best place to build fast evidence.";
  redAlertImpact.textContent = focusImpact;
  if (focusWhy) {
    // Keep it collapsed by default to reduce visual load.
    focusWhy.open = false;
  }
  const focusCategory = primary.driver;

  // Use focus experiments from /api/analyze only if they are unique enough.
  const focusExperimentsFromReport = Array.isArray(report?.focus_experiments) ? report.focus_experiments : [];
  const hasUniqueTitles = (list) => {
    const titles = list.map((e) => String(e?.title || "").trim().toLowerCase());
    const base = (t) => String(t || "").split("—")[0].trim();
    const bases = titles.map(base);
    return new Set(titles).size === list.length && new Set(bases).size === list.length;
  };
  if (focusExperimentsFromReport.length === 3 && hasUniqueTitles(focusExperimentsFromReport)) {
    state.experiments[focusCategory] = {
      category: focusCategory,
      experiments: focusExperimentsFromReport,
      _meta: { mode: "seeded" }
    };
    saveState();
    renderCategoryCards(focusCategory);
  } else {
    if (focusLoading) focusLoading.textContent = "Loading your tiny experiments...";
    fetchExperiments(focusCategory)
      .then(() => {
        renderCategoryCards(focusCategory);
      })
      .catch((err) => {
        if (focusLoading) focusLoading.textContent = "AI couldn’t load experiments. Try again.";
        if (debugRaw) debugRaw.textContent = String(err.message || "");
        debugBlock?.classList.remove("hidden");
      });
  }

  if (focusHeading) {
    focusHeading.textContent = "Pick One Tiny Experiment";
  }

  // Lesson step (kept local so it’s instant and consistent).
  if (lessonTitle && lessonBody && lessonCards) {
    const lesson = report?.lesson;
    const title = toSentences(lesson?.title) || "A Quick Lesson";
    const points = Array.isArray(lesson?.points) ? lesson.points.map(toSentences).filter(Boolean) : [];
    lessonTitle.textContent = title;
    lessonBody.textContent = "";
    if (lessonNext) {
      lessonNext.textContent = "Next: you’ll pick one tiny experiment to practice today (under 10 minutes).";
    }

    lessonCards.innerHTML = "";
    const finalPoints = points.slice(0, 3);
    if (finalPoints.length !== 3) {
      const div = document.createElement("div");
      div.className = "lesson-card";
      div.innerHTML = `<h4>Lesson unavailable</h4><p class="muted">AI didn’t return a full lesson this time. Hit Start Over to try again.</p>`;
      lessonCards.appendChild(div);
    }

    finalPoints.forEach((p, idx) => {
      // Strip any accidental [bracketed] titles so the lesson reads naturally.
      const clean = String(p || "").replace(/\[([^\]]+)\]/g, "$1");
      const div = document.createElement("div");
      const labels = ["The mechanism", "Why it developed", "How to rewire it"];
      const text = clean
        .replace(/^The mechanism:\s*/i, "")
        .replace(/^Why it developed:\s*/i, "")
        .replace(/^How to rewire it:\s*/i, "");
      div.className = "lesson-card";
      div.innerHTML = `<h4>${labels[idx] || "Key idea"}</h4><p class="muted">${text}</p>`;
      lessonCards.appendChild(div);
    });
  }

  redAlertBlock.classList.remove("hidden");

  // Chat bootstrap
  if (!Array.isArray(state.chat?.messages)) state.chat = { messages: [] };
  if (state.chat.messages.length === 0) {
    state.chat.messages.push({
      role: "assistant",
      content:
        `I’ve got your snapshot. Your focus area is ${focusCategory} (${redAlertProfile.textContent}). ` +
        "What’s one situation this week where you want more confidence (work, social, decisions, or stress)?"
    });
  }
  renderChat();
}

function renderCategoryCards(focusCategory) {
  if (!catCards) return;
  if (focusLoading) focusLoading.textContent = "";
  const order = ["Acceptance", "Agency", "Autonomy", "Adaptability"];
  catCards.innerHTML = "";
  order.forEach((cat) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `cat-card${cat === focusCategory ? " is-focus" : ""}`;
    btn.innerHTML = `
      <div class="cat-card-top">
        <div class="cat-card-title">${cat}</div>
        ${cat === focusCategory ? `<span class="badge">Focus</span>` : ""}
      </div>
      <div class="cat-card-sub muted">3 tiny options</div>
    `;
    btn.addEventListener("click", () => openCategoryModal(cat, focusCategory));
    catCards.appendChild(btn);
  });
}

function showModal(show) {
  if (!expModal) return;
  if (show) expModal.classList.remove("hidden");
  else expModal.classList.add("hidden");
}

async function openCategoryModal(category, focusCategory) {
  state.ui.selectedCategory = category;
  saveState();
  if (expModalTitle) expModalTitle.textContent = category;
  if (expModalKicker) expModalKicker.textContent = category === focusCategory ? "Focus category" : "Tiny experiments";
  if (expSaveStatus) expSaveStatus.textContent = "";
  if (expList) expList.innerHTML = `<div class="muted">Loading…</div>`;
  showModal(true);

  try {
    if (!state.experiments?.[category]?.experiments?.length) {
      await fetchExperiments(category);
    }
    const items = Array.isArray(state.experiments?.[category]?.experiments)
      ? state.experiments[category].experiments.slice(0, 3)
      : [];
    renderExperimentList(category, items, focusCategory);
  } catch (e) {
    if (expList) expList.innerHTML = `<div class="muted">AI couldn’t load this category. Try again.</div>`;
    if (debugRaw) debugRaw.textContent = String(e.message || "");
    debugBlock?.classList.remove("hidden");
  }
}

function renderExperimentList(category, items) {
  if (!expList) return;
  expList.innerHTML = "";
  if (!items.length) {
    expList.innerHTML = `<div class="muted">No experiments returned.</div>`;
    return;
  }

  items.forEach((it, idx) => {
    const title = toSentences(it?.title);
    const action = toSentences(it?.action);
    const why = toSentences(it?.why);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "exp-pick";
    btn.innerHTML = `
      <div class="exp-pick-head">
        <div class="exp-pick-title">${title || `Option ${idx + 1}`}</div>
        <span class="exp-pick-tag">Click to choose</span>
      </div>
      <div class="exp-pick-action muted">${action || ""}</div>
      ${why ? `<div class="exp-pick-why muted small">${why}</div>` : ""}
    `;
    btn.addEventListener("click", async () => {
      if (expSaveStatus) expSaveStatus.textContent = "Saving…";
      try {
        await trackExperimentChoice({ category, index: idx, title, action });
        if (expSaveStatus) expSaveStatus.textContent = "Saved. Do it once today.";
        setTimeout(() => showModal(false), 650);
      } catch (e) {
        const msg = String(e.message || "");
        if (expSaveStatus) expSaveStatus.textContent = msg ? msg.split("\n")[0].slice(0, 120) : "Couldn’t save. Try again.";
        if (debugRaw) debugRaw.textContent = String(e.message || "");
        debugBlock?.classList.remove("hidden");
      }
    });
    expList.appendChild(btn);
  });
}

function getAnonId() {
  const key = "confidence-atlas-anon-id";
  let id = localStorage.getItem(key);
  if (!id) {
    id = Math.random().toString(36).slice(2) + "-" + Date.now().toString(36);
    localStorage.setItem(key, id);
  }
  return id;
}

async function trackExperimentChoice(chosen) {
  if (!chosen) throw new Error("No experiment selected");
  const { totals, overallAvg } = scoreDrivers();
  const primary = primaryProfileFromTotals(totals);
  const payload = {
    anon_id: getAnonId(),
    ts: new Date().toISOString(),
    provider: state.report?._meta?.provider || "",
    trust_index_status: classifyBigTrust(overallAvg).level,
    primary_profile: state.report?.primary_profile || primary.profile,
    focus_category: primary.driver,
    experiment_category: chosen.category,
    experiment_index: chosen.index,
    experiment_title: chosen.title,
    experiment_action: chosen.action,
    overall_score: Number(overallAvg.toFixed(2)),
    answers: state.responses.slice(0, 12)
  };

  const response = await fetchWithTimeout(
    TRACK_URL,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    },
    15000
  );

  if (!response.ok) {
    const txt = await response.text();
    throw new Error(txt || "Track failed");
  }
}

// Modal UX
if (expModalClose) expModalClose.addEventListener("click", () => showModal(false));
if (expModalBackdrop) expModalBackdrop.addEventListener("click", () => showModal(false));
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") showModal(false);
});

function startSurvey() {
  // Always start fresh so old responses don't leak into new runs.
  state.responses = Array(QUESTIONS.length).fill(null);
  state.report = null;
  state.experiments = {};
  state.chat = { messages: [] };
  saveState();
  currentQuestion = 0;
  showPanel(surveyPanel);
  renderQuestion();
}

function buildChatContext() {
  const { totals, avgs, overallAvg } = scoreDrivers();
  return {
    scores: {
      driver_totals: totals,
      driver_averages: avgs,
      overall_average: overallAvg
    },
    report: state.report
  };
}

function renderChat() {
  if (!chatLog) return;
  chatLog.innerHTML = "";
  const msgs = state.chat?.messages || [];
  msgs.forEach((m) => {
    const div = document.createElement("div");
    div.className = `bubble ${m.role === "user" ? "user" : "assistant"}`;
    div.textContent = m.content;
    chatLog.appendChild(div);
  });
  chatLog.scrollTop = chatLog.scrollHeight;
}

async function sendChatMessage(text) {
  const clean = String(text || "").trim();
  if (!clean) return;

  state.chat.messages.push({ role: "user", content: clean });
  renderChat();
  saveState();

  chatStatus.textContent = "Thinking...";
  chatInput.disabled = true;

  try {
    const response = await fetchWithTimeout(CHAT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: state.chat.messages,
        context: buildChatContext()
      })
    }, 45000);

    if (!response.ok) {
      const errText = await response.text();
      let message = errText;
      try {
        const parsed = JSON.parse(errText);
        message = parsed?.error?.message || message;
        if (parsed?.error?.retry_after_ms) {
          message = `${message}\nretry_after_ms=${parsed.error.retry_after_ms}`;
        }
      } catch {
        // ignore
      }
      throw new Error(message);
    }

    const data = await response.json();
    const reply = (data?.reply || "").trim();
    state.chat.messages.push({ role: "assistant", content: reply || "I couldn’t generate a reply. Try again." });
    renderChat();
    saveState();
    chatStatus.textContent = "";
  } catch (error) {
    chatStatus.textContent = `Chat error: ${error.message}`;
    console.error("Chat failed", error);
  } finally {
    chatInput.disabled = false;
    chatInput.focus();
  }
}

async function finishSurvey() {
  showPanel(resultsPanel);
  llmStatus.textContent = "Analyzing your responses with AI...";
  redAlertBlock.classList.add("hidden");
  debugBlock?.classList.add("hidden");
  state.report = null;
  state.experiments = {};
  state.chat = { messages: [] };
  resetResultsSteps();
  renderResults();
  renderChat();

  try {
    const report = await analyzeWithLLM();
    applyLLMReport(report);
    const provider = report?._meta?.provider || "ai";
    llmStatus.textContent =
      provider.toLowerCase() === "nvidia"
        ? "Personalized by NVIDIA (Qwen)."
        : provider.toLowerCase() === "groq"
          ? "Personalized by Groq."
        : "Personalized by Gemini 2.5 Flash.";
  } catch (error) {
    renderResults();
    const msg = String(error.message || "");
    const retryMatch = msg.match(/retry_after_ms[:=]\s*(\d+)/i);
    const ms = retryMatch?.[1] ? Number(retryMatch[1]) : null;
    if (ms && Number.isFinite(ms)) {
      llmStatus.textContent = `Rate limit hit. Try again in ${Math.max(1, Math.ceil(ms / 1000))}s.`;
    } else if (msg.includes("reason=LLM_TIMEOUT") || msg.toLowerCase().includes("timeout")) {
      llmStatus.textContent = "AI is taking longer than usual. Please try again.";
    } else {
      llmStatus.textContent = `AI couldn’t analyze.`;
    }
    if (debugRaw) debugRaw.textContent = String(error.message || "");
    debugBlock?.classList.remove("hidden");
    console.error("LLM analysis failed", error);
  }

  saveState();
}

beginBtn.addEventListener("click", () => startSurvey());

surveyBack.addEventListener("click", () => {
  if (currentQuestion === 0) return;
  currentQuestion -= 1;
  renderQuestion();
});

surveyExit.addEventListener("click", () => {
  showPanel(heroPanel);
});

restartBtn.addEventListener("click", () => {
  localStorage.removeItem(STORAGE_KEY);
  state.responses = Array(QUESTIONS.length).fill(null);
  state.report = null;
  showPanel(heroPanel);
});

// Coach chat toggle
const coachToggleBtn = document.getElementById("coach-toggle-btn");
const coachChatInner = document.getElementById("coach-chat-inner");
if (coachToggleBtn && coachChatInner) {
  coachToggleBtn.addEventListener("click", () => {
    const isHidden = coachChatInner.classList.contains("hidden");
    coachChatInner.classList.toggle("hidden", !isHidden);
    coachToggleBtn.textContent = isHidden
      ? "Close coach chat"
      : "Explore more with the coach";
    if (isHidden) {
      renderChat();
      setTimeout(() => {
        coachChatInner.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    }
  });
}

// Logout removed for now.

loadState();
if (state.report) {
  renderResults();
  applyLLMReport(state.report);
  showPanel(resultsPanel);
} else {
  showPanel(heroPanel);
}

if (chatForm) {
  chatForm.addEventListener("submit", (e) => {
    e.preventDefault();
    sendChatMessage(chatInput.value);
    chatInput.value = "";
  });
}

// Step navigation
if (step1Next) step1Next.addEventListener("click", () => showResultsStep(2));
if (step2Back) step2Back.addEventListener("click", () => showResultsStep(1));
if (step2Next) step2Next.addEventListener("click", () => showResultsStep(3));
if (step3Back) step3Back.addEventListener("click", () => showResultsStep(2));
