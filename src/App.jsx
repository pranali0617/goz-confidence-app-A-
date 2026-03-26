import React, { useEffect, useMemo, useRef, useState } from "react";

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
  { label: "Strongly Agree", value: 1 },
  { label: "Agree", value: 2 },
  { label: "Neutral", value: 3 },
  { label: "Disagree", value: 4 },
  { label: "Strongly Disagree", value: 5 }
];

const DRIVERS = {
  Acceptance: [0, 3, 6],
  Agency: [2, 4, 7],
  Autonomy: [5, 8, 9],
  Adaptability: [1, 10, 11]
};

const STORAGE_KEY = "confidence-atlas";
const API_URL = "/api/analyze";
const EXP_URL = "/api/experiments";
const CHAT_URL = "/api/chat";
const TRACK_URL = "/api/track";

function fetchWithTimeout(url, options = {}, timeoutMs = 45000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal })
    .catch((e) => {
      if (e?.name === "AbortError") {
        throw new Error("AI timeout. Please try again.\nreason=LLM_TIMEOUT");
      }
      throw e;
    })
    .finally(() => clearTimeout(id));
}

function scoreDrivers(responses) {
  const totals = {};
  const avgs = {};
  Object.entries(DRIVERS).forEach(([driver, indexes]) => {
    const total = indexes.reduce((sum, idx) => sum + (responses[idx] || 0), 0);
    totals[driver] = total;
    avgs[driver] = total / indexes.length;
  });
  const overallTotal = Object.values(totals).reduce((a, b) => a + b, 0);
  const overallAvg = overallTotal / QUESTIONS.length;
  return { totals, avgs, overallAvg };
}

function classifyBigTrust(overallAvg) {
  if (overallAvg <= 2.2) return { level: "Red Alert", one_liner: "Your doubt is loud right now. We'll build trust with micro-wins." };
  if (overallAvg <= 3.6) return { level: "Situational Doubt", one_liner: "Your confidence shifts with context. We'll stabilize it with a simple circuit." };
  return { level: "Big Trust", one_liner: "You have strong self-trust. We'll keep sharpening it with small reps." };
}

function primaryProfileFromTotals(totals) {
  const entries = Object.entries(totals);
  entries.sort((a, b) => a[1] - b[1]);
  const driver = entries[0]?.[0] || "Acceptance";
  const map = {
    Acceptance: "The Approval Seeker",
    Agency: "The Perfectionist",
    Autonomy: "The Passenger",
    Adaptability: "The Overthinker"
  };
  return { driver, profile: map[driver] || "The Approval Seeker" };
}

function driverColor(driver) {
  if (driver === "Acceptance") return "#0e2a74";
  if (driver === "Agency") return "#3f8fe6";
  if (driver === "Autonomy") return "#6ecfd0";
  return "#ff864a";
}

function toSentences(str) {
  if (!str) return "";
  return String(str).replace(/\s+/g, " ").trim();
}

function getAnonId() {
  const key = "confidence-atlas-anon-id";
  let id = localStorage.getItem(key);
  if (!id) {
    id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem(key, id);
  }
  return id;
}

export default function App() {
  const [panel, setPanel] = useState("hero");
  const [responses, setResponses] = useState(Array(QUESTIONS.length).fill(null));
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [resultsStep, setResultsStep] = useState(1);
  const [animStep, setAnimStep] = useState(0);
  const [report, setReport] = useState(null);
  const [experiments, setExperiments] = useState({});
  const [chatMessages, setChatMessages] = useState([]);
  const [llmStatus, setLlmStatus] = useState("");
  const [debugRaw, setDebugRaw] = useState("");
  const [showDebug, setShowDebug] = useState(false);
  const [focusLoading, setFocusLoading] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [modalCategory, setModalCategory] = useState("");
  const [modalItems, setModalItems] = useState([]);
  const [modalSaveStatus, setModalSaveStatus] = useState("");
  const [coachOpen, setCoachOpen] = useState(false);
  const chatInputRef = useRef(null);

  const { totals, avgs, overallAvg } = useMemo(() => scoreDrivers(responses), [responses]);
  const trust = useMemo(() => classifyBigTrust(overallAvg), [overallAvg]);
  const primary = useMemo(() => primaryProfileFromTotals(totals), [totals]);
  const focusCategory = primary.driver;

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return;
    try {
      const state = JSON.parse(saved);
      if (state?.responses) setResponses(state.responses);
      if (state?.report) setReport(state.report);
      if (state?.experiments) setExperiments(state.experiments);
      if (state?.chat?.messages) setChatMessages(state.chat.messages);
      if (state?.ui?.resultsStep) setResultsStep(state.ui.resultsStep);
      if (state?.ui?.resultsStep) setAnimStep(state.ui.resultsStep);
      if (state?.report) setPanel("results");
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    const state = {
      responses,
      report,
      experiments,
      chat: { messages: chatMessages },
      ui: { resultsStep }
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [responses, report, experiments, chatMessages, resultsStep]);

  useEffect(() => {
    setAnimStep(resultsStep);
    const t = setTimeout(() => setAnimStep(0), 360);
    try {
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      window.scrollTo(0, 0);
    }
    return () => clearTimeout(t);
  }, [resultsStep]);

  useEffect(() => {
    if (!report) return;
    const existing = experiments?.[focusCategory]?.experiments?.length;
    if (existing) {
      setFocusLoading("");
      return;
    }
    setFocusLoading("Loading your tiny experiments...");
    fetchExperiments(focusCategory)
      .then(() => setFocusLoading(""))
      .catch((e) => {
        setFocusLoading("AI couldn’t load experiments. Try again.");
        setDebugRaw(String(e.message || ""));
        setShowDebug(true);
      });
  }, [report, focusCategory]); // eslint-disable-line react-hooks/exhaustive-deps

  function startSurvey() {
    setResponses(Array(QUESTIONS.length).fill(null));
    setReport(null);
    setExperiments({});
    setChatMessages([]);
    setResultsStep(1);
    setCurrentQuestion(0);
    setPanel("survey");
  }

  function handleOptionSelect(value) {
    const nextResponses = responses.slice();
    nextResponses[currentQuestion] = value;
    setResponses(nextResponses);
    setTimeout(() => {
      if (currentQuestion === QUESTIONS.length - 1) {
        finishSurvey(nextResponses);
      } else {
        setCurrentQuestion((q) => q + 1);
      }
    }, 520);
  }

  async function analyzeWithLLM(payloadResponses) {
    const { totals, avgs, overallAvg } = scoreDrivers(payloadResponses);
    const response = await fetchWithTimeout(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        questions: QUESTIONS,
        answers: payloadResponses,
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
      const bodyText = await response.text();
      let message = bodyText;
      try {
        const parsed = JSON.parse(bodyText || "{}");
        message = parsed?.error?.message || parsed?.message || message;
        if (parsed?.error?.retry_after_ms) {
          message += `\nretry_after_ms=${parsed.error.retry_after_ms}`;
        }
      } catch {
        // ignore
      }
      throw new Error(message || "AI failed");
    }
    return response.json();
  }

  function hasUniqueTitles(list) {
    const titles = list.map((e) => String(e?.title || "").trim().toLowerCase());
    const base = (t) => String(t || "").split("—")[0].trim();
    const bases = titles.map(base);
    return new Set(titles).size === list.length && new Set(bases).size === list.length;
  }

  async function finishSurvey(payloadResponses) {
    setPanel("results");
    setLlmStatus("Analyzing your responses with AI...");
    setShowDebug(false);
    setDebugRaw("");
    setReport(null);
    setExperiments({});
    setChatMessages([]);
    setResultsStep(1);

    try {
      const data = await analyzeWithLLM(payloadResponses);
      setReport(data);
      const provider = data?._meta?.provider || "ai";
      setLlmStatus(
        provider.toLowerCase() === "nvidia"
          ? "Personalized by NVIDIA (Qwen)."
          : provider.toLowerCase() === "groq"
            ? "Personalized by Groq."
            : "Personalized by Gemini 2.5 Flash."
      );

      const focusExperiments = Array.isArray(data?.focus_experiments) ? data.focus_experiments : [];
      if (focusExperiments.length === 3 && hasUniqueTitles(focusExperiments)) {
        setExperiments((prev) => ({
          ...prev,
          [focusCategory]: { category: focusCategory, experiments: focusExperiments, _meta: { mode: "seeded" } }
        }));
      }

      setChatMessages([
        {
          role: "assistant",
          content: `I’ve got your snapshot. Your focus area is ${focusCategory} (${data?.primary_profile || primary.profile}). ` +
            "What’s one situation this week where you want more confidence (work, social, decisions, or stress)?"
        }
      ]);
    } catch (error) {
      const msg = String(error.message || "");
      const retryMatch = msg.match(/retry_after_ms[:=]\s*(\d+)/i);
      const ms = retryMatch?.[1] ? Number(retryMatch[1]) : null;
      if (ms && Number.isFinite(ms)) {
        setLlmStatus(`Rate limit hit. Try again in ${Math.max(1, Math.ceil(ms / 1000))}s.`);
      } else if (msg.includes("reason=LLM_TIMEOUT") || msg.toLowerCase().includes("timeout")) {
        setLlmStatus("AI is taking longer than usual. Please try again.");
      } else {
        setLlmStatus("AI couldn’t analyze.");
      }
      setDebugRaw(msg);
      setShowDebug(true);
    }
  }

  async function fetchExperiments(category) {
    const response = await fetchWithTimeout(EXP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answers: responses, category })
    }, 45000);

    if (!response.ok) {
      const bodyText = await response.text();
      throw new Error(bodyText || "AI failed");
    }
    const data = await response.json();
    setExperiments((prev) => ({ ...prev, [category]: data }));
    return data;
  }

  async function openCategoryModal(category) {
    setModalCategory(category);
    setModalSaveStatus("");
    setModalItems([]);
    setModalOpen(true);

    try {
      let data = experiments[category];
      if (!data?.experiments?.length) {
        data = await fetchExperiments(category);
      }
      const items = Array.isArray(data?.experiments) ? data.experiments.slice(0, 3) : [];
      setModalItems(items);
    } catch (e) {
      setModalItems([]);
      setDebugRaw(String(e.message || ""));
      setShowDebug(true);
    }
  }

  async function trackExperimentChoice({ category, index, title, action }) {
    const payload = {
      anon_id: getAnonId(),
      ts: new Date().toISOString(),
      provider: report?._meta?.provider || "ai",
      trust_index_status: report?.trust_index_status || trust.level,
      primary_profile: report?.primary_profile || primary.profile,
      focus_category: focusCategory,
      experiment_category: category,
      experiment_index: index,
      experiment_title: title,
      experiment_action: action,
      overall_score: Number(overallAvg.toFixed(2)),
      answers: responses.slice(0, 12)
    };

    const response = await fetchWithTimeout(TRACK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }, 15000);

    if (!response.ok) {
      const bodyText = await response.text();
      throw new Error(bodyText || "Tracking failed");
    }
    return response.json();
  }

  async function sendChatMessage(text) {
    const trimmed = String(text || "").trim();
    if (!trimmed) return;

    const nextMessages = [...chatMessages, { role: "user", content: trimmed }];
    setChatMessages(nextMessages);

    try {
      const response = await fetchWithTimeout(CHAT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages,
          context: {
            scores: { driver_totals: totals, driver_averages: avgs, overall_average: overallAvg },
            report
          }
        })
      }, 45000);
      if (!response.ok) {
        const bodyText = await response.text();
        throw new Error(bodyText || "Chat failed");
      }
      const data = await response.json();
      setChatMessages((prev) => [...prev, { role: "assistant", content: data.reply }]);
    } catch (e) {
      setChatMessages((prev) => [...prev, { role: "assistant", content: "AI is taking longer than usual. Please try again." }]);
    }
  }

  const lesson = report?.lesson || null;
  const lessonPoints = Array.isArray(lesson?.points) ? lesson.points.map(toSentences).filter(Boolean) : [];
  const lessonTitle = toSentences(lesson?.title) || "A Quick Lesson";
  const lessonLabels = ["The mechanism", "Why it developed", "How to rewire it"];

  const stepLabel = resultsStep === 1 ? "Snapshot" : resultsStep === 2 ? "Learn" : "Practice";

  return (
    <main className="page">
      <section className={`panel hero ${panel === "hero" ? "" : "hidden"}`}>
        <div className="hero-icon" aria-hidden="true">
          <svg viewBox="0 0 48 48" role="img" focusable="false">
            <path d="M24 6l14 6v10c0 9.5-6.4 16.4-14 20-7.6-3.6-14-10.5-14-20V12l14-6z" fill="none" stroke="currentColor" strokeWidth="2.5" />
            <path d="M17 25l5 5 9-11" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="34" cy="14" r="3" fill="currentColor" />
          </svg>
        </div>
        <h1>Confidence Atlas</h1>
        <p className="subtitle hero-subtitle">
          <span>A 2-minute Doubt Profile check-in to spot what’s quietly shrinking your confidence.</span>
          <span>Get a tiny experiment you can do today to strengthen your self-trust this week.</span>
        </p>
        <button className="primary" onClick={startSurvey}>Start the confidence check-in</button>
        <div className="hero-marks">
          <span>Clarity</span>
          <span>Momentum</span>
          <span>Practice</span>
        </div>
      </section>

      <section className={`panel survey ${panel === "survey" ? "" : "hidden"}`}>
        <div className="survey-card">
          <div className="survey-header">
            <div className="survey-brand">
              <div className="survey-icon" aria-hidden="true">
                <svg viewBox="0 0 48 48" role="img" focusable="false">
                  <path d="M24 6l14 6v10c0 9.5-6.4 16.4-14 20-7.6-3.6-14-10.5-14-20V12l14-6z" fill="none" stroke="currentColor" strokeWidth="2.5" />
                  <path d="M17 25l5 5 9-11" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                  <circle cx="34" cy="14" r="3" fill="currentColor" />
                </svg>
              </div>
              <div>
                <p className="survey-title">Confidence Atlas</p>
                <p className="survey-subtitle">Your confidence guide</p>
              </div>
            </div>
            <button className="ghost" onClick={() => setPanel("hero")}>Exit</button>
          </div>

          <div className="question-block">
            <p className="greeting">Welcome. Take a breath and answer honestly.</p>
            <p className="question">{QUESTIONS[currentQuestion]}</p>
          </div>

          <div className="options">
            {OPTIONS.map((opt, idx) => (
              <button
                key={opt.value}
                type="button"
                className={`option ${responses[currentQuestion] === opt.value ? "selected" : ""}`}
                onClick={() => handleOptionSelect(opt.value)}
              >
                <strong>{String.fromCharCode(65 + idx)}</strong> {opt.label}
              </button>
            ))}
          </div>

          <div className="progress">
            <span>{currentQuestion + 1} / {QUESTIONS.length}</span>
            <button
              className="ghost"
              onClick={() => setCurrentQuestion((q) => Math.max(0, q - 1))}
              disabled={currentQuestion === 0}
            >
              Back
            </button>
          </div>
        </div>
      </section>

      <section className={`panel results ${panel === "results" ? "" : "hidden"}`}>
        <div className="result-card">
          <div className="steps-head" aria-hidden="true">
            <div className="steps-dots">
              <span className={`dot ${resultsStep === 1 ? "is-active" : ""}`}></span>
              <span className={`dot ${resultsStep === 2 ? "is-active" : ""}`}></span>
              <span className={`dot ${resultsStep === 3 ? "is-active" : ""}`}></span>
            </div>
            <div className="steps-label">{stepLabel}</div>
          </div>

          <section className={`results-step ${resultsStep === 1 ? "" : "hidden"} ${animStep === 1 ? "step-in" : ""}`}>
            <div className="result-head">
              <div>
                <h2>Your Big Trust Index</h2>
                <p className="subtitle">{report?.psychological_insight || trust.one_liner}</p>
              </div>
              <div className="pill">{report?.trust_index_status || trust.level}</div>
            </div>
            <div className="index-bar" aria-hidden="true">
              <div className="index-fill" style={{ width: `${Math.round(((overallAvg - 1) / 4) * 100)}%` }}></div>
              <div className="index-tick"></div>
              <div className="index-tick index-tick-2"></div>
            </div>
            <div className="index-labels" aria-hidden="true">
              <span>Red Alert</span>
              <span>Situational Doubt</span>
              <span>Big Trust</span>
            </div>
            <p className="small">{llmStatus}</p>

            <div className="result-block">
              <h3>Your Doubt Profile</h3>
              <p className="muted">Lower scores mean more doubt. Taller bars mean stronger self-trust in that area.</p>
              <div className="meta">
                <span className="chip">Overall: {overallAvg.toFixed(1)}/5</span>
              </div>
              <div className="chart-wrap">
                <div className="y-axis" aria-hidden="true">
                  <div>Superpower</div>
                  <div>Hidden Strength</div>
                  <div>So-So</div>
                  <div>Hindrance</div>
                  <div>Red Alert</div>
                </div>
                <div className="bars">
                  {Object.keys(DRIVERS).map((driver) => {
                    const avg = avgs[driver] || 1;
                    const heightPct = Math.max(5, Math.min(100, ((avg - 1) / 4) * 100));
                    const band =
                      avg <= 2 ? "Red Alert" :
                      avg <= 2.8 ? "Hindrance" :
                      avg <= 3.6 ? "So-So" :
                      avg <= 4.3 ? "Hidden Strength" :
                      "Superpower";
                    return (
                      <div className="bar" key={driver}>
                        <div className="bar-fill" style={{ height: `${heightPct}%`, background: driverColor(driver) }}></div>
                        <div className="bar-label">
                          {driver}
                          <small>{band}</small>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="step-nav">
              <button className="primary full" onClick={() => setResultsStep(2)}>Continue</button>
            </div>
          </section>

          <section className={`results-step ${resultsStep === 2 ? "" : "hidden"} ${animStep === 2 ? "step-in" : ""}`}>
            <div className="result-block">
              <h3>{lessonTitle}</h3>
              <p className="muted"></p>
              <div className="lesson-cards">
                {lessonPoints.length === 3 ? lessonPoints.map((p, idx) => {
                  const clean = String(p || "").replace(/\[([^\]]+)\]/g, "$1");
                  const text = clean
                    .replace(/^The mechanism:\s*/i, "")
                    .replace(/^Why it developed:\s*/i, "")
                    .replace(/^How to rewire it:\s*/i, "");
                  return (
                    <div className="lesson-card" key={idx}>
                      <h4>{lessonLabels[idx]}</h4>
                      <p className="muted">{text}</p>
                    </div>
                  );
                }) : (
                  <div className="lesson-card">
                    <h4>Lesson unavailable</h4>
                    <p className="muted">AI didn’t return a full lesson this time. Hit Start Over to try again.</p>
                  </div>
                )}
              </div>
              <div className="muted lesson-next">Next: you’ll pick one tiny experiment to practice today (under 10 minutes).</div>
            </div>
            <div className="step-nav two">
              <button className="secondary full" onClick={() => setResultsStep(1)}>Back</button>
              <button className="primary full" onClick={() => setResultsStep(3)}>Continue</button>
            </div>
          </section>

          <section
            id="step-3"
            className={`results-step ${resultsStep === 3 ? "" : "hidden"} ${animStep === 3 ? "step-in" : ""}`}
          >
            <div className="result-block">
              <div className="split-head">
                <div>
                  <h3>Pick One Tiny Experiment</h3>
                  <p className="muted small">Under 10 minutes. Start with your focus, or explore other categories.</p>
                  <p className="experiment-name hidden">{report?.primary_profile || primary.profile}</p>
                </div>
                <div className="pill subtle">Focus</div>
              </div>
              <details className="muted">
                <summary>Why this is your focus</summary>
                <span>{report?.psychological_insight || "This is your lowest-scoring driver right now, so it’s the best place to build fast evidence."}</span>
              </details>
              <p className="muted">{focusLoading}</p>
              <div className="cat-cards" aria-label="Experiment categories">
                {["Acceptance", "Agency", "Autonomy", "Adaptability"].map((cat) => (
                  <button
                    key={cat}
                    className={`cat-card ${cat === focusCategory ? "is-focus" : ""}`}
                    type="button"
                    onClick={() => openCategoryModal(cat)}
                  >
                    <div className="cat-title">{cat}</div>
                    <div className="cat-meta">3 tiny options</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="result-block" id="coach-block">
              <button className="ghost full" type="button" onClick={() => setCoachOpen((v) => !v)}>
                {coachOpen ? "Close coach chat" : "Explore more with the coach"}
              </button>
              {coachOpen ? (
                <div className="coach-chat-inner">
                  <h3>Coach Chat</h3>
                  <div className="muted small">Tell the coach what you’re working on. You’ll get one tiny next step.</div>
                  <div className="chat">
                    <div className="chat-log" aria-live="polite">
                      {chatMessages.map((m, idx) => (
                        <div key={idx} className={`bubble ${m.role === "user" ? "user" : "assistant"}`}>{m.content}</div>
                      ))}
                    </div>
                    <form
                      className="chat-form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        sendChatMessage(chatInputRef.current?.value);
                        if (chatInputRef.current) chatInputRef.current.value = "";
                      }}
                    >
                      <input className="chat-input" ref={chatInputRef} type="text" placeholder="Type a message..." autoComplete="off" />
                      <button className="primary" type="submit">Send</button>
                    </form>
                  </div>
                </div>
              ) : null}
            </div>

            {showDebug ? (
              <details className="result-block">
                <summary>Debug (AI raw)</summary>
                <pre className="debug-pre">{debugRaw}</pre>
              </details>
            ) : null}

            <div className="step-nav two">
              <button className="secondary full" onClick={() => setResultsStep(2)}>Back</button>
              <button className="ghost full" onClick={() => {
                localStorage.removeItem(STORAGE_KEY);
                setResponses(Array(QUESTIONS.length).fill(null));
                setReport(null);
                setExperiments({});
                setChatMessages([]);
                setResultsStep(1);
                setPanel("hero");
              }}>Start Over</button>
            </div>
          </section>
        </div>
      </section>

      {modalOpen ? (
        <div className="modal" role="dialog" aria-modal="true" aria-labelledby="exp-modal-title">
          <div className="modal-backdrop" onClick={() => setModalOpen(false)}></div>
          <div className="modal-card">
            <div className="modal-head">
              <div>
                <div className="muted small">Tiny experiments</div>
                <h3 id="exp-modal-title">{modalCategory}</h3>
              </div>
              <button className="ghost" type="button" onClick={() => setModalOpen(false)}>Close</button>
            </div>
            <div className="modal-body">
              <div className="muted small">Tap a card to choose. We’ll save it automatically.</div>
              <div className="exp-list">
                {modalItems.length ? modalItems.map((it, idx) => (
                  <button
                    key={`${modalCategory}-${idx}`}
                    type="button"
                    className="exp-pick"
                    onClick={async () => {
                      setModalSaveStatus("Saving…");
                      try {
                        await trackExperimentChoice({ category: modalCategory, index: idx, title: toSentences(it?.title), action: toSentences(it?.action) });
                        setModalSaveStatus("Saved. Do it once today.");
                        setTimeout(() => setModalOpen(false), 650);
                      } catch (e) {
                        const msg = String(e.message || "");
                        setModalSaveStatus(msg ? msg.split("\n")[0].slice(0, 120) : "Couldn’t save. Try again.");
                        setDebugRaw(String(e.message || ""));
                        setShowDebug(true);
                      }
                    }}
                  >
                    <div className="exp-pick-head">
                      <div className="exp-pick-title">{toSentences(it?.title) || `Option ${idx + 1}`}</div>
                      <span className="exp-pick-tag">Click to choose</span>
                    </div>
                    <div className="exp-pick-action muted">{toSentences(it?.action)}</div>
                    {it?.why ? <div className="exp-pick-why muted small">{toSentences(it?.why)}</div> : null}
                  </button>
                )) : (
                  <div className="muted">Loading…</div>
                )}
              </div>
              <p className="small muted">{modalSaveStatus}</p>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
