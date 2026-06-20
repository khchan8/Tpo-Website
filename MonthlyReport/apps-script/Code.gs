/**
 * TPO Wellness — Apps Script (commentary generator + settings).
 *
 * Bound to the Google Sheet (Extensions → Apps Script → paste this file).
 * Adds a custom menu: 📊 TPO
 *   - Generate Commentary…    (generate All / one view)
 *   - Test Gemini Connection  (single-token ping)
 *   - Settings…               (set API key + model)
 *   - Clear API Key           (wipe stored key)
 *
 * What it does
 *   1. Reads the data tabs.
 *   2. For each view, builds a prompt that includes ONLY pre-computed figures
 *      (synthesizer-not-calculator: the model writes prose, never math).
 *   3. Calls Gemini using the model + API key stored in Script Properties.
 *   4. Writes the result to the Commentary tab (View | Commentary).
 *
 * Setup (one-time)
 *   - Extensions → Apps Script → paste this file → save.
 *   - Reload the sheet. The "📊 TPO" menu appears.
 *   - 📊 TPO → Settings… → paste your Gemini API key → choose a model → Save.
 *
 * Storage
 *   - GEMINI_API_KEY   ScriptProperty (write-only from this script's UI)
 *   - GEMINI_MODEL     ScriptProperty (default: gemini-1.5-flash)
 *   - GEMINI_CUSTOM_MODEL  ScriptProperty (only set if "custom" is chosen)
 *
 * Security
 *   - Keys live in PropertiesService, never in code or the sheet.
 *   - The HTML dialog never echoes the key back to the server; it just confirms
 *     "saved" / "connection ok".
 */

// ---------- tabs ----------
const TABS = {
  ASSUMPTIONS:   "Assumptions",
  MONTHLY:       "MonthlyFinancials",
  CUST_REV:      "CustomerRevenueMonthly",
  CUST_COUNT:    "CustomerCount",
  QUARTERLY:     "Quarterly Financials",
  WORKING_CAP:   "1. Working Capital",
  CUST_ECON:     "2. Customer Economics",
  DASHBOARD:     "3. Strategic Dashboard",
  FORWARD:       "4. Forward-Looking Risk",
  COMMENTARY:    "Commentary",
};

// ---------- curated model registry ----------
// Each entry has { id, label, hint }. The default is "gemini-1.5-flash".
// Users can also pick "Custom…" and type any model id they have access to.
const GEMINI_MODELS = [
  { id: "gemini-1.5-flash",       label: "Gemini 1.5 Flash",       hint: "Cheapest, fastest. Good default for monthly commentary." },
  { id: "gemini-1.5-flash-8b",    label: "Gemini 1.5 Flash-8B",    hint: "Smallest, very low latency. Use for very short copy." },
  { id: "gemini-1.5-pro",         label: "Gemini 1.5 Pro",         hint: "Higher quality reasoning than Flash." },
  { id: "gemini-2.0-flash",       label: "Gemini 2.0 Flash",       hint: "Newer Flash; better quality, similar price tier." },
  { id: "gemini-2.0-flash-lite",  label: "Gemini 2.0 Flash-Lite",  hint: "Lightest 2.0 model — fastest." },
  { id: "gemini-2.5-flash",       label: "Gemini 2.5 Flash",       hint: "Latest Flash generation." },
  { id: "gemini-2.5-pro",         label: "Gemini 2.5 Pro",         hint: "Latest Pro generation. Best quality, slower, pricier." },
  { id: "gemini-3.0-pro",         label: "Gemini 3.0 Pro (preview)", hint: "Preview tier — quality may vary." },
  { id: "gemini-3.1-pro",         label: "Gemini 3.1 Pro",         hint: "If your account has access." },
  { id: "__custom__",             label: "Custom…",                hint: "Type any model id your key can access." },
];
const DEFAULT_MODEL = "gemini-1.5-flash";

// MiniMax (MiniMax) — OpenAI-compatible /chat/completions endpoint.
// https://api.minimaxi.com/v1  — Bearer auth.
// Includes the M-series (MiniMax-M / MiniMax-Text-01 / abab-6.5s / abab-7 …).
const MINIMAX_MODELS = [
  { id: "MiniMax-Text-01",      label: "MiniMax Text-01",            hint: "MiniMax flagship text model." },
  { id: "MiniMax-M1",           label: "MiniMax M1",                 hint: "MiniMax M-series reasoning model." },
  { id: "MiniMax-M2",           label: "MiniMax M2",                 hint: "Newer MiniMax M-series." },
  { id: "MiniMax-M2-Stable",    label: "MiniMax M2 Stable",          hint: "Stable snapshot of MiniMax M2." },
  { id: "MiniMax-M3",           label: "MiniMax M3",                 hint: "Latest MiniMax M-series model." },
  { id: "MiniMax-01",           label: "MiniMax 01",                 hint: "MiniMax 01 generation." },
  { id: "abab-6.5s-chat",       label: "abab-6.5s Chat",             hint: "Earlier MiniMax chat model (abab series)." },
  { id: "abab-7-chat",          label: "abab-7 Chat",                hint: "Earlier MiniMax chat model (abab series)." },
  { id: "__custom__",           label: "Custom…",                    hint: "Type any model id your key can access." },
];
const MINIMAX_DEFAULT_MODEL = "MiniMax-Text-01";
const MINIMAX_DEFAULT_ENDPOINT = "https://api.minimaxi.com/v1";

// OpenAI-compatible generic provider (works with OpenAI, Together, Groq, etc.)
const OPENAI_COMPAT_MODELS = [
  { id: "gpt-4o-mini",          label: "GPT-4o mini",          hint: "OpenAI cheap default." },
  { id: "gpt-4o",               label: "GPT-4o",               hint: "OpenAI flagship." },
  { id: "gpt-4.1-mini",         label: "GPT-4.1 mini",         hint: "OpenAI 4.1 mini." },
  { id: "o4-mini",              label: "o4-mini",              hint: "OpenAI reasoning." },
  { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B (Groq)", hint: "Fast open model via Groq." },
  { id: "mixtral-8x7b-32768",   label: "Mixtral 8x7B (Groq)",  hint: "Fast open model via Groq." },
  { id: "__custom__",           label: "Custom…",              hint: "Type any model id your key can access." },
];
const OPENAI_COMPAT_DEFAULT_MODEL = "gpt-4o-mini";

// Helper used by Settings UI to return the right registry for a provider.
function modelsForProvider_(provider) {
  if (provider === "minimax")       return MINIMAX_MODELS;
  if (provider === "openai_compat") return OPENAI_COMPAT_MODELS;
  return GEMINI_MODELS;
}
function defaultModelForProvider_(provider) {
  if (provider === "minimax")       return MINIMAX_DEFAULT_MODEL;
  if (provider === "openai_compat") return OPENAI_COMPAT_DEFAULT_MODEL;
  return DEFAULT_MODEL;
}

// Thin client-facing wrapper used by the Settings dialog when the user
// switches provider — returns the right registry without re-fetching the
// full settings state.
function getModelsForProvider(provider) {
  const p = String(provider || "gemini").toLowerCase();
  return {
    provider: p,
    models: modelsForProvider_(p),
    defaultModel: defaultModelForProvider_(p),
  };
}

// Live model listing for OpenAI-compatible providers.
// Hits GET {endpoint}/models with Bearer auth and parses the response.
// `key` may be empty — falls back to the stored key for the current provider.
// `provider` is the provider the user is configuring in the dialog (so the
// default-model hint is right even if they haven't saved yet).
// Returns { ok, code, message, models:[{id,label,hint}], defaultModel }
function fetchEndpointModels(endpoint, key, provider) {
  try {
    const ep = String(endpoint || "").trim().replace(/\/+$/, "");
    if (!ep) return { ok: false, code: 0, message: "Endpoint URL is empty." };
    const useKey = String(key || "").trim() || getApiKey_();
    if (!useKey) return { ok: false, code: 0, message: "No API key available." };
    const url = ep + "/models";
    const res = UrlFetchApp.fetch(url, {
      method: "get",
      headers: { "Authorization": "Bearer " + useKey },
      muteHttpExceptions: true,
    });
    const code = res.getResponseCode();
    if (code !== 200) {
      return { ok: false, code, message: res.getContentText().slice(0, 400) };
    }
    const json = JSON.parse(res.getContentText());
    const models = parseModelList_(json);
    if (!models.length) {
      return { ok: false, code: 200, message: "Endpoint returned no models in expected shape.", models: [] };
    }
    // Pick a sensible default: the provider's hardcoded default if it's in the
    // fetched list, else just the first.
    const prov = String(provider || getProvider_() || "gemini").toLowerCase();
    const want = String(defaultModelForProvider_(prov) || "");
    const def = (want && models.find(m => m.id === want)) ? want : models[0].id;
    return { ok: true, code: 200, models, defaultModel: def, provider: prov };
  } catch (e) {
    return { ok: false, code: 0, message: e.message || String(e) };
  }
}

// Pull `{id, label?, hint?}` items out of any of the common response shapes:
//   OpenAI:        { data: [{ id, object, owned_by, ... }, ...] }
//   OpenRouter-ish:{ data: [{ id, name, ... }, ...] }  (name used as label)
//   MiniMax alt:   { models: [{ id, ... }, ...] }        (assumed)
//   Bare array:    [{ id }, ...]
//   { models: "..." } (string — OpenRouter legacy)       (skipped)
function parseModelList_(json) {
  const out = [];
  let arr = null;
  if (Array.isArray(json)) arr = json;
  else if (json && Array.isArray(json.data))   arr = json.data;
  else if (json && Array.isArray(json.models)) arr = json.models;
  if (!arr) return out;
  for (const m of arr) {
    if (!m || typeof m !== "object") continue;
    const id = String(m.id || m.name || "").trim();
    if (!id) continue;
    // Label: explicit label > name > id
    const label = String(m.label || m.name || id).trim();
    // Hint: anything that looks like a description / owner / context length
    let hint = "";
    if (typeof m.description === "string" && m.description.trim()) hint = m.description.trim();
    else if (typeof m.owned_by === "string" && m.owned_by.trim())  hint = "Owner: " + m.owned_by.trim();
    else if (m.context_length) hint = "Context: " + m.context_length.toLocaleString() + " tokens";
    out.push({ id, label, hint });
  }
  // Dedup by id, keep first
  const seen = new Set();
  return out.filter(m => seen.has(m.id) ? false : (seen.add(m.id), true));
}

// ---------- menu ----------
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("📊 TPO")
    .addItem("Generate Commentary (Resume)…", "menuResumeCommentary")
    .addItem("Generate Commentary (Force All)…", "menuGenerateCommentary")
    .addItem("Pause Commentary",               "menuPauseCommentary")
    .addItem("Reset Commentary Status",       "menuResetCommentaryStatus")
    .addSeparator()
    .addItem("Test Gemini Connection",        "testGeminiConnection")
    .addSeparator()
    .addSubMenu(SpreadsheetApp.getUi().createMenu("Settings")
      .addItem("Open Settings…",              "openSettings")
      .addItem("Show current settings",       "showCurrentSettings")
      .addItem("Clear API Key",               "clearApiKey"))
    .addToUi();
}

// ---------- properties ----------
function props_() { return PropertiesService.getScriptProperties(); }

// Provider + key + endpoint + model — provider-aware accessors.
// Legacy Gemini-only keys (GEMINI_API_KEY / GEMINI_MODEL) keep working.
function getProvider_() {
  const p = String(props_().getProperty("LLM_PROVIDER") || "").toLowerCase();
  if (p === "minimax" || p === "openai_compat") return p;
  return "gemini";
}
function getApiKey_() {
  const p = getProvider_();
  if (p === "gemini") {
    return props_().getProperty("LLM_API_KEY")
        || props_().getProperty("GEMINI_API_KEY")
        || PropertiesService.getUserProperties().getProperty("GEMINI_API_KEY")
        || PropertiesService.getUserProperties().getProperty("LLM_API_KEY")
        || "";
  }
  // MiniMax + OpenAI-compat both use a Bearer token.
  return props_().getProperty("LLM_API_KEY")
      || PropertiesService.getUserProperties().getProperty("LLM_API_KEY")
      || "";
}
function getEndpoint_() {
  const p = getProvider_();
  const e = props_().getProperty("LLM_ENDPOINT");
  if (e) return e;
  if (p === "minimax")       return "https://api.minimaxi.com/v1";
  if (p === "openai_compat") return "https://api.openai.com/v1";
  return ""; // Gemini doesn't use an endpoint
}
function getModel_() {
  const p = getProvider_();
  let id;
  if (p === "gemini") {
    id = props_().getProperty("LLM_MODEL") || props_().getProperty("GEMINI_MODEL") || DEFAULT_MODEL;
  } else {
    id = props_().getProperty("LLM_MODEL") || (p === "minimax" ? "MiniMax-Text-01" : "gpt-4o-mini");
  }
  if (id === "__custom__") return props_().getProperty("LLM_CUSTOM_MODEL") || id;
  return id;
}

// Rate-limit sequence on/off. When ON (Gemini default): synthetic exponential
// backoff between retries (1500 → 3000 → 6000 …). When OFF (MiniMax / paid
// tier default): retry immediately on transient errors; still respect the
// server's Retry-After / retryDelay hint if it sends one.
// Stored as LLM_RATE_LIMIT script property ("on" / "off"). If unset, defaults
// to ON for Gemini and OFF for OpenAI-compatible providers.
function getRateLimit_() {
  const raw = String(props_().getProperty("LLM_RATE_LIMIT") || "").toLowerCase();
  if (raw === "on" || raw === "off") return raw;
  // provider default
  return getProvider_() === "gemini" ? "on" : "off";
}
function setRateLimit_(val) {
  const v = String(val || "").toLowerCase() === "on" ? "on" : "off";
  props_().setProperty("LLM_RATE_LIMIT", v);
  return v;
}

// ---------- sheet helpers ----------
function getRows_(tabName) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(tabName);
  if (!sh) throw new Error(`Missing tab: ${tabName}`);
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(1, 1, last, sh.getLastColumn()).getValues();
}
function toNumber_(v) {
  if (v === "" || v === null || v === undefined) return null;
  if (typeof v === "number") return v;
  const s = String(v).replace(/[฿,\s]/g, "").replace(/^\((.*)\)$/, "-$1");
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}
function fmtTHB_(n) {
  if (n === null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e6) return "฿" + (n / 1e6).toFixed(2) + "M";
  if (abs >= 1e3) return "฿" + (n / 1e3).toFixed(1) + "K";
  return "฿" + Math.round(n).toLocaleString();
}
function fmtPct_(n, d = 1) {
  if (n === null || !Number.isFinite(n)) return "—";
  return (n * 100).toFixed(d) + "%";
}
function isLowSeason_(label) {
  const m = /^([A-Za-z]{3})-\d{2}$/.exec(String(label || "").trim());
  if (!m) return false;
  return ["Jun","Jul","Aug","Sep","Oct"].includes(m[1]);
}
function quarterOf_(label) {
  const m = /^([A-Za-z]{3})-(\d{2})$/.exec(String(label || "").trim());
  if (!m) return null;
  const mon = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"].indexOf(m[1]);
  if (mon < 0) return null;
  return "Q" + (Math.floor(mon / 3) + 1) + " 20" + m[2];
}

// ---------- LLM dispatcher ----------
// Knobs (tuned for free-tier Gemini quotas, which throttle at ~5 req/min/model):
const LLM_MAX_OUTPUT_TOKENS = 1024;    // was 600 — free-tier can truncate mid-sentence at 600
const LLM_MAX_RETRIES       = 5;        // retries per request on 429 / 5xx
const LLM_BASE_BACKOFF_MS   = 1500;     // initial backoff; doubles each attempt
const LLM_MAX_BACKOFF_MS    = 60000;    // cap on a single backoff sleep
const LLM_CONCURRENCY       = 2;        // in-flight requests (free tier: 2 keeps us safely under 5/min)
const LLM_STAGGER_MS        = 250;      // pause between starting each concurrent slot

// Single entry point used by Generate Commentary. Dispatches to the
// provider-specific call below, sharing the retry/backoff loop.
function callLLM_(prompt, opts) {
  opts = opts || {};
  const provider = getProvider_();
  if (!getApiKey_()) {
    throw new Error(
      (provider === "gemini" ? "Gemini" : provider === "minimax" ? "MiniMax" : "OpenAI-compatible")
      + " API key not set. Open 📊 TPO → Settings… to add one."
    );
  }
  if (provider === "minimax" || provider === "openai_compat") {
    return callOpenAICompat_(prompt, opts);
  }
  return callGemini_(prompt, opts);
}

// ---------- Gemini ----------
function callGemini_(prompt, opts) {
  opts = opts || {};
  const model = getModel_();
  const key = getApiKey_();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${key}`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.4, maxOutputTokens: LLM_MAX_OUTPUT_TOKENS },
  };
  return runWithRetry_(model, body, /*requestFn*/ () => UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  }), opts);
}

// ---------- OpenAI-compatible (MiniMax, OpenAI, Groq, Together, …) ----------
// POST {endpoint}/chat/completions
// Headers: Authorization: Bearer <key>
// Body:    { model, messages: [{role:"user", content}], temperature, max_tokens }
function callOpenAICompat_(prompt, opts) {
  opts = opts || {};
  const provider = getProvider_();
  const endpoint = String(getEndpoint_() || "").replace(/\/+$/, "");
  if (!endpoint) throw new Error(`${provider} endpoint URL is empty. Set it in Settings.`);
  const model = getModel_();
  const key = getApiKey_();
  const url = `${endpoint}/chat/completions`;
  const body = {
    model,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.4,
    max_tokens: LLM_MAX_OUTPUT_TOKENS,
    stream: false,
  };
  return runWithRetry_(model, body, /*requestFn*/ () => UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    headers: { "Authorization": "Bearer " + key },
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  }), opts);
}

// ---------- shared retry/backoff loop ----------
// `label` is the model id (used in logs/errors/toasts).
// `requestFn()` returns UrlFetchApp.HTTPResponse.
// `extractText(json)` returns the assistant text or throws if malformed.
function runWithRetry_(label, requestBody, requestFn, opts) {
  opts = opts || {};
  const maxRetries = (opts.maxRetries != null) ? opts.maxRetries : LLM_MAX_RETRIES;
  const onRetry = typeof opts.onRetry === "function" ? opts.onRetry : null;
  // Rate-limit sequence: when OFF, base backoff is 0 (retry immediately) but
  // we still honor the server's Retry-After hint and the absolute cap.
  const rateLimited = getRateLimit_() === "on";
  const baseMs = rateLimited ? LLM_BASE_BACKOFF_MS : 0;

  const sleepWithBackoff_ = (attempt, code, detail) => {
    let backoffMs = baseMs * Math.pow(2, attempt);
    const hintMs = parseRetryDelayMs_(detail);
    if (hintMs !== null) backoffMs = Math.max(backoffMs, hintMs);
    backoffMs = Math.min(backoffMs, LLM_MAX_BACKOFF_MS);
    if (onRetry) onRetry({ attempt: attempt + 1, maxRetries, code, sleepMs: backoffMs, rateLimited });
    Logger.log(`… ${label} HTTP ${code}; attempt ${attempt + 1}/${maxRetries}, sleeping ${backoffMs}ms (rateLimit=${rateLimited})`);
    Utilities.sleep(backoffMs);
  };

  let lastErr = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = requestFn();
    const code = res.getResponseCode();

    if (code === 200) {
      const json = JSON.parse(res.getContentText());
      const text = extractAssistantText_(json);
      if (!text) throw new Error(`Empty ${label} response: ` + JSON.stringify(json).slice(0, 400));
      const trimmed = text.trim();
      // Truncation guard: if the model ran out of tokens, retry once with a
      // wider budget instead of letting half a sentence land in the sheet.
      const finishReason = extractFinishReason_(json);
      const looksTruncated = /MAX_TOKENS|TRUNCATED|LENGTH/i.test(finishReason)
        || (!/[.!?。]\s*$/.test(trimmed) && trimmed.length > 400);
      if (looksTruncated && attempt < maxRetries) {
        Logger.log(`… ${label} truncated (${finishReason || "no-terminator"}); retrying`);
        sleepWithBackoff_(attempt, /*synthetic*/ 499, `truncated (${finishReason || "no-terminator"})`);
        continue;
      }
      return trimmed;
    }

    const detail = res.getContentText().slice(0, 400);
    const retryable = code === 429 || code === 408 || (code >= 500 && code < 600);
    if (!retryable || attempt === maxRetries) {
      throw new Error(`${label} HTTP ${code}: ${detail}`);
    }

    sleepWithBackoff_(attempt, code, detail);
    lastErr = new Error(`${label} HTTP ${code}: ${detail}`);
  }
  throw lastErr || new Error(`${label} retries exhausted`);
}

// Pull a reasoning model's thinking trace out of an LLM response so the
// board-facing commentary stays tight. Handles both common shapes:
//   • <<think>...</think>...answer     (DeepSeek, MiniMax-M, Qwen-QwQ, o1, etc.)
//   • <|channel|>analysis<|message|>...<|end|><|start|>assistant<|message|>answer
//   • Leading "Reasoning: ..." prose
// Returns { commentary, thinking } — either may be empty.
function splitThinking_(text) {
  if (!text) return { commentary: "", thinking: "" };
  const raw = String(text);

  // 1) MiniMax / DeepSeek / QwQ / Kimi / GLM-Z1 style: <think>…</think>
  const thinkMatch = raw.match(/<think>([\s\S]*?)<\/think>/i);
  if (thinkMatch) {
    const thinking = thinkMatch[1].trim();
    const rest = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
    return { commentary: rest, thinking };
  }

  // 2) Mistral / Llama 3.x channel style (defensive — some providers use it)
  const chanMatch = raw.match(/<\|channel\|>analysis<\|message\|>([\s\S]*?)<\|end\|>/i);
  if (chanMatch) {
    const thinking = chanMatch[1].trim();
    const rest = raw
      .replace(/<\|channel\|>analysis<\|message\|>[\s\S]*?<\|end\|>/i, "")
      .replace(/<\|start\|>assistant<\|message\|>/gi, "")
      .replace(/<\|end\|>/gi, "")
      .replace(/<\|message\|>/gi, "")
      .trim();
    return { commentary: rest, thinking };
  }

  // 3) Plain "Reasoning: …\n\nAnswer: …" (rare — some local servers)
  const reasonMatch = raw.match(/^\s*(?:Reasoning|Thought)\s*:\s*([\s\S]*?)\n\s*(?:Answer|Response|Final)\s*:\s*([\s\S]*)$/i);
  if (reasonMatch) {
    return { commentary: reasonMatch[2].trim(), thinking: reasonMatch[1].trim() };
  }

  return { commentary: raw.trim(), thinking: "" };
}

// Provider-aware text extractor. Gemini: candidates[0].content.parts[0].text.
// OpenAI-compat: choices[0].message.content.
function extractAssistantText_(json) {
  if (!json) return null;
  // OpenAI-compatible shape
  if (Array.isArray(json.choices) && json.choices.length) {
    const c = json.choices[0];
    return (c?.message?.content || c?.text || "").trim() || null;
  }
  // Gemini shape
  const cand = json?.candidates?.[0];
  return cand?.content?.parts?.[0]?.text || null;
}
function extractFinishReason_(json) {
  if (Array.isArray(json.choices) && json.choices.length) {
    return json.choices[0].finish_reason || "";
  }
  return json?.candidates?.[0]?.finishReason || "";
}

// Extract "retry in 6.788s" from a Gemini/MiniMax error body. Returns ms or null.
function parseRetryDelayMs_(body) {
  const m = /retry in\s+([\d.]+)\s*s/i.exec(body || "");
  if (!m) return null;
  const sec = parseFloat(m[1]);
  return Number.isFinite(sec) ? Math.ceil(sec * 1000) + 250 : null;
}

// ---------- prompts (unchanged) ----------
const STYLE_RULES = `
Writing style:
- Executive briefing tone, plain English, no marketing fluff.
- 2 to 4 sentences (50–90 words) per view.
- Lead with the single most important number in the figures block.
- Reference the low season (Jun–Oct) and the Q2 2026 partial-period rule when relevant.
- Never invent a number. If a figure you want to mention is not in the block, do not mention it.
- Avoid filler phrases ("dive into", "journey", "navigate", "unlock"). No bullet points.
`.trim();

function buildPrompt_(view, figures) {
  return [
    `You are writing the "Briefing" block for the "${view}" section of TPO Wellness's monthly board report.`,
    "",
    "FIGURES (these are the only numbers you may use):",
    figures,
    "",
    STYLE_RULES,
  ].join("\n");
}

function rollupQuarterly_(monthly) {
  const byQ = {};
  for (const r of monthly) {
    // Skip blank rows
    if (!r || !r[0]) continue;
    // Coerce to string — Sheets can return Date objects, numbers, or formula
    // errors in any cell. Anything non-string would break localeCompare later.
    const month = String(r[0]).trim();
    if (!month) continue;
    let q = r[1];
    if (q !== null && q !== undefined && q !== "") {
      // If the Quarter cell came back as a Date (Sheets quirk when a cell is
      // typed as a date by mistake), drop it and re-derive from the Month label.
      if (q instanceof Date) q = quarterOf_(month);
      else                   q = String(q).trim();
    } else {
      q = quarterOf_(month);
    }
    if (!q) continue;
    const slot = byQ[q] || (byQ[q] = { quarter: q, revenue: 0, cogs: 0, gp: 0, sga: 0, ebit: 0, netIncome: 0, months: [] });
    slot.revenue   += toNumber_(r[2]) || 0;
    slot.cogs      += toNumber_(r[3]) || 0;
    slot.gp        += toNumber_(r[4]) || 0;
    slot.sga       += toNumber_(r[5]) || 0;
    slot.ebit      += toNumber_(r[6]) || 0;
    slot.netIncome += toNumber_(r[7]) || 0;
    slot.months.push(month);
  }
  // Chronological sort by parsed year + quarter number (not alpha).
  return Object.values(byQ).sort((a, b) => {
    const parse = (q) => {
      const m = /^Q([1-4])\s+(\d{4})$/.exec(String(q || ""));
      return m ? { q: +m[1], y: +m[2] } : { q: 9, y: 9999 };
    };
    const A = parse(a.quarter), B = parse(b.quarter);
    return A.y - B.y || A.q - B.q;
  });
}
function concentrationLatest_(custRevRows, monthly) {
  if (!monthly.length) return null;
  const last = monthly[monthly.length - 1][0];
  const buckets = {}; let total = 0;
  for (let i = 1; i < custRevRows.length; i++) {
    const c = custRevRows[i][0], m = custRevRows[i][1], v = toNumber_(custRevRows[i][2]);
    if (m !== last || !c || v === null) continue;
    buckets[c] = (buckets[c] || 0) + v;
    total += v;
  }
  const items = Object.entries(buckets)
    .map(([name, revenue]) => ({ name, revenue, share: total ? revenue / total : 0 }))
    .sort((a, b) => b.revenue - a.revenue);
  return { latest: last, total, items };
}

function buildOverviewFigures_(monthly, custRev, dashboardRows) {
  const last = monthly[monthly.length - 1];
  const rev = toNumber_(last[2]);
  const gp  = toNumber_(last[4]);
  const margin = rev ? gp / rev : null;
  const ytdRev = monthly
    .filter(r => r[0] && quarterOf_(r[0]) && quarterOf_(r[0]).endsWith("20" + String(last[0]).slice(-2)))
    .reduce((s, r) => s + (toNumber_(r[2]) || 0), 0);
  const conc = concentrationLatest_(custRev, monthly) || { items: [], latest: "" };
  const top = conc.items.slice(0, 3).map(i => `${i.name} ${(i.share*100).toFixed(1)}%`).join(", ");
  const dash = dashboardRows.slice(3).map(r => `${r[0]}: ${r[1]}`).filter(Boolean).slice(0, 4);
  return [
    `Latest month (${last[0]}): Revenue ${fmtTHB_(rev)}, Gross Profit ${fmtTHB_(gp)}, Gross Margin ${fmtPct_(margin)}.`,
    `YTD revenue: ${fmtTHB_(ytdRev)}.`,
    `Customer mix (${conc.latest}): ${top || "—"}.`,
    `Low season: Jun–Oct.`,
    `Strategic dashboard: ${dash.join(" | ")}.`,
  ].join("\n");
}
function buildSeasonalityFigures_(monthly, custCount) {
  const last = monthly[monthly.length - 1];
  const trail6 = monthly.slice(-6).reduce((s, r) => s + (toNumber_(r[2]) || 0), 0);
  const lowRev = monthly.filter(r => isLowSeason_(r[0])).reduce((s, r) => s + (toNumber_(r[2]) || 0), 0);
  const peak = custCount.reduce((a, b) => (toNumber_(b[1]) > toNumber_(a[1]) ? b : a));
  const trough = custCount.reduce((a, b) => (toNumber_(b[1]) < toNumber_(a[1]) ? b : a));
  return [
    `Last 6 months revenue: ${fmtTHB_(trail6)}.`,
    `Low-season revenue total: ${fmtTHB_(lowRev)}.`,
    `Customer count peak: ${peak[1]} (${peak[0]}); trough: ${trough[1]} (${trough[0]}).`,
    `Current month: ${last[0]} → ${isLowSeason_(last[0]) ? "in low season" : "outside low season"}.`,
  ].join("\n");
}
function buildCustomerFigures_(name, custRev) {
  const series = [];
  for (let i = 1; i < custRev.length; i++) {
    if (custRev[i][0] === name) series.push({ month: String(custRev[i][1] || "").trim(), revenue: toNumber_(custRev[i][2]) });
  }
  // Chronological sort by parsed year + month number (not alpha).
  series.sort((a, b) => {
    const parse = (lbl) => {
      const m = /^([A-Za-z]{3})-(\d{2})$/.exec(String(lbl || ""));
      if (!m) return { y: 9999, mon: 99 };
      const mon = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"].indexOf(m[1]);
      return { y: 2000 + +m[2], mon: mon < 0 ? 99 : mon };
    };
    const A = parse(a.month), B = parse(b.month);
    return A.y - B.y || A.mon - B.mon;
  });
  if (!series.length) return `Customer: ${name}.\nNo revenue rows found.`;
  const last = series[series.length - 1];
  const ytdRev = series
    .filter(p => p.month && quarterOf_(p.month) && quarterOf_(p.month).endsWith("20" + String(last.month).slice(-2)))
    .reduce((s, p) => s + (p.revenue || 0), 0);
  return [
    `Customer: ${name}.`,
    `Latest month (${last.month}): Revenue ${fmtTHB_(last.revenue)}.`,
    `YTD revenue: ${fmtTHB_(ytdRev)}.`,
    `Months reported: ${series.length}.`,
  ].join("\n");
}
function buildWorkingCapitalFigures_(wcRows) {
  const header = wcRows[1];
  const months = header.slice(1);
  const findRow = (substr) => wcRows.find(r => String(r[0]).toLowerCase().includes(substr));
  const last = months.length - 1;
  const val = (row) => toNumber_(row?.[last + 1]);
  return [
    `As of ${months[last]}: Cash ${fmtTHB_(val(findRow("cash")))}, AR ${fmtTHB_(val(findRow("accounts receivable")))}, Inventory ${fmtTHB_(val(findRow("inventory")))}, AP ${fmtTHB_(val(findRow("accounts payable")))}.`,
    `Net Working Capital: ${fmtTHB_(val(findRow("net working capital")))}.`,
    `NWC formula: Cash + AR + Inventory − AP.`,
  ].join("\n");
}
function buildFinancialsFigures_(quarterly) {
  const q = (label) => quarterly.find(x => x.quarter === label);
  const q1_25 = q("Q1 2025"), q1_26 = q("Q1 2026"), q2_26 = q("Q2 2026");
  const delta = (q1_25 && q1_26 && q1_25.revenue) ? (q1_26.revenue - q1_25.revenue) / q1_25.revenue : null;
  const partial = q2_26 && q2_26.months.length < 3;
  return [
    `Q1 2025 revenue: ${fmtTHB_(q1_25?.revenue)} · Q1 2026 revenue: ${fmtTHB_(q1_26?.revenue)} · Δ ${fmtPct_(delta)}.`,
    `Q2 2026 (${q2_26 ? q2_26.months.length : 0} months): ${fmtTHB_(q2_26?.revenue)}${partial ? " — PARTIAL; do not annualize." : ""}.`,
    `Q1 2026 Gross Profit: ${fmtTHB_(q1_26?.gp)} · EBIT: ${fmtTHB_(q1_26?.ebit)}.`,
  ].join("\n");
}
function buildForwardLookingFigures_(forwardRows) {
  const items = forwardRows.slice(3).filter(r => r[0]).slice(0, 5)
    .map(r => `${r[0]}: ${r[1] || "—"}${r[2] ? " — " + r[2] : ""}`);
  return [`Risks from the Forward-Looking tab:`, ...items].join("\n");
}

// ---------- Commentary tab schema ----------
// Col A: View (slug), B: Commentary text,
// Col C: Status ("✓ model mm-dd HH:MM" or blank),
// Col D: Started (timestamp),
// Col E: Error (last failure message),
// Col F: Attempts (integer),
// Col G: Thinking Info — the reasoning trace from a thinking model
//       (e.g. <think>...</think>) so it doesn't bloat the board-facing
//       commentary. Empty for non-reasoning models.
const COMMENTARY_HEADERS = ["View", "Commentary", "Status", "Started", "Error", "Attempts", "Thinking Info"];
const COMMENTARY_TRIGGER_HANDLER = "triggerTickResumable_";

// Ensure the Commentary tab has the new 6-column schema (idempotent).
function ensureCommentarySchema_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TABS.COMMENTARY);
  if (!sh) throw new Error(`Missing tab: ${TABS.COMMENTARY}`);

  // Header row
  const headerRange = sh.getRange(1, 1, 1, COMMENTARY_HEADERS.length);
  const currentHeader = headerRange.getValues()[0];
  const needsHeader = COMMENTARY_HEADERS.some((h, i) => currentHeader[i] !== h);
  if (needsHeader) {
    headerRange.setValues([COMMENTARY_HEADERS]);
    headerRange.setFontWeight("bold");
    sh.setFrozenRows(1);
  }
  // Make sure we have enough columns (resize only if we just expanded).
  const lastCol = sh.getLastColumn();
  if (lastCol < COMMENTARY_HEADERS.length) {
    sh.insertColumnsAfter(lastCol, COMMENTARY_HEADERS.length - lastCol);
  }
  // Sensible column widths if they look untouched.
  if (!sh.getColumnWidth(2) || sh.getColumnWidth(2) < 60) sh.setColumnWidth(2, 480);
  if (!sh.getColumnWidth(3) || sh.getColumnWidth(3) < 22) sh.setColumnWidth(3, 28);
  if (!sh.getColumnWidth(5) || sh.getColumnWidth(5) < 40) sh.setColumnWidth(5, 60);
  if (!sh.getColumnWidth(7) || sh.getColumnWidth(7) < 40) sh.setColumnWidth(7, 320);
}

// Read the Commentary tab into a list of { row, view, text, status, started, error, attempts, thinking }.
function readCommentaryRows_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TABS.COMMENTARY);
  if (!sh || sh.getLastRow() < 2) return [];
  const n = sh.getLastRow() - 1;
  const cols = Math.max(COMMENTARY_HEADERS.length, sh.getLastColumn() || COMMENTARY_HEADERS.length);
  const vals = sh.getRange(2, 1, n, cols).getValues();
  return vals
    .map((r, i) => ({
      row:        i + 2,
      view:       String(r[0] || "").trim(),
      text:       String(r[1] || ""),
      status:     String(r[2] || "").trim(),
      started:    String(r[3] || "").trim(),
      error:      String(r[4] || "").trim(),
      attempts:   r[5] === "" || r[5] === null || r[5] === undefined ? 0 : Number(r[5]) || 0,
      thinking:   String(r[6] || ""),
    }))
    .filter(r => r.view);
}

// Write a single cell update.
// Set a single Commentary-tab cell. `sheetCol` is 1-indexed (A=1, B=2, C=3, …).
function writeCommentaryCol_(row, sheetCol, value) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TABS.COMMENTARY);
  sh.getRange(row, sheetCol, 1, 1).setValue(value);
}

// Build the full ordered list of (view, prompt). Independent of sheet state.
function buildAllTasks_() {
  const monthly    = getRows_(TABS.MONTHLY);
  const custRev    = getRows_(TABS.CUST_REV);
  const custCount  = getRows_(TABS.CUST_COUNT);
  const quarterly  = rollupQuarterly_(monthly);
  const dashRows   = getRows_(TABS.DASHBOARD);
  const forwardRows= getRows_(TABS.FORWARD);
  const wcRows     = getRows_(TABS.WORKING_CAP);
  const customers  = getRows_(TABS.ASSUMPTIONS).slice(1)
                       .map(r => String(r[0] || "").trim()).filter(Boolean)
                       .filter((v, i, a) => a.indexOf(v) === i);

  return [
    ["overview",              buildPrompt_("Overview",              buildOverviewFigures_(monthly, custRev, dashRows))],
    ["seasonality",           buildPrompt_("Seasonality",           buildSeasonalityFigures_(monthly, custCount))],
    ["working-capital",       buildPrompt_("Working Capital",       buildWorkingCapitalFigures_(wcRows))],
    ["financial-performance", buildPrompt_("Financial Performance", buildFinancialsFigures_(quarterly))],
    ["forward-looking",       buildPrompt_("Forward-Looking",       buildForwardLookingFigures_(forwardRows))],
    ...customers.map(name => [
      name.toLowerCase().replace(/\s+/g, "-"),
      buildPrompt_(name, buildCustomerFigures_(name, custRev)),
    ]),
  ];
}

// Make sure every task has a row in the Commentary tab.
// New rows get appended in task order; existing rows keep their positions.
function ensureRowsForAllTasks_() {
  ensureCommentarySchema_();
  const tasks = buildAllTasks_();
  const rows = readCommentaryRows_();
  const byView = Object.fromEntries(rows.map(r => [r.view, r]));

  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TABS.COMMENTARY);
  const desired = tasks.map(t => t[0]);
  const present = rows.map(r => r.view);

  // Add any missing views at the bottom.
  for (const view of desired) {
    if (!byView[view]) {
      const newRow = sh.getLastRow() + 1;
      sh.getRange(newRow, 1, 1, COMMENTARY_HEADERS.length).setValues([[view, "", "", "", "", 0, ""]]);
      byView[view] = { row: newRow, view, text: "", status: "", started: "", error: "", attempts: 0 };
    }
  }
  // (Order isn't critical — we re-derive order from buildAllTasks_ every run.)
}

// Pick the first row whose Status is blank (regardless of order in sheet).
function pickNextPending_() {
  const rows = readCommentaryRows_();
  const tasks = buildAllTasks_();
  const promptByView = Object.fromEntries(tasks.map(t => [t[0], t[1]]));
  for (const r of rows) {
    if (!r.status) {
      const prompt = promptByView[r.view];
      if (prompt) return { row: r, prompt };
    }
  }
  return null;
}

// ---------- toast helper ----------
function toast_(message, title, timeoutSeconds) {
  try {
    SpreadsheetApp.getActiveSpreadsheet().toast(
      String(message),
      title || "📊 TPO · Generating",
      Math.min(30, Math.max(2, timeoutSeconds || 5))
    );
  } catch (_) {}
}

function fmtDuration_(ms) {
  const s = Math.round(ms / 100) / 10;
  return s < 10 ? s.toFixed(1) + "s" : Math.round(s) + "s";
}

function nowStamp_() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Run a SINGLE pending task. Writes Status, Error, Attempts in the sheet.
// Safe to call from a time-driven trigger — should always finish well under
// the 6-minute Apps Script cap (one request with up to ~60s of backoff sleep).
function runOnePending_(opts) {
  opts = opts || {};
  ensureRowsForAllTasks_();
  const next = pickNextPending_();
  if (!next) {
    const allRows = readCommentaryRows_();
    const done = allRows.length;
    if (opts.silent !== true) {
      toast_(`All ${done} briefings already generated ✓`, "📊 TPO · Done", 4);
    }
    uninstallResumableTrigger_();
    return { done: true, total: done };
  }

  const { row, prompt } = next;
  const view = row.view;
  const label = humanViewName_(view);

  // Mark "started"
  writeCommentaryCol_(row.row, 2, "");              // B: clear commentary
  writeCommentaryCol_(row.row, 3, `running…`);      // C: Status
  writeCommentaryCol_(row.row, 4, new Date());      // D: Started
  writeCommentaryCol_(row.row, 6, (row.attempts || 0) + 1); // F: Attempts
  writeCommentaryCol_(row.row, 5, "");              // E: clear Error
  writeCommentaryCol_(row.row, 7, "");              // G: clear Thinking Info

  toast_(`▶ ${label} (${view}) — generating…`, "📊 TPO · Generating", 8);

  let lastRetryToastAt = 0;
  const started = Date.now();
  try {
    const text = callLLM_(prompt, {
      onRetry: (info) => {
        const now = Date.now();
        if (now - lastRetryToastAt < 800 && info.attempt < info.maxRetries) return;
        lastRetryToastAt = now;
        toast_(
          `↻ ${label} — HTTP ${info.code} — retrying in ${(info.sleepMs/1000).toFixed(1)}s ` +
          `(attempt ${info.attempt}/${info.maxRetries})`,
          "📊 TPO · Rate-limited",
          Math.max(3, Math.ceil(info.sleepMs / 1000) + 1)
        );
      },
    });
    // Success — split off any thinking trace, then write commentary + status.
    const split = splitThinking_(text);
    writeCommentaryCol_(row.row, 2, split.commentary);                  // B: Commentary
    writeCommentaryCol_(row.row, 7, split.thinking || "");              // G: Thinking Info
    const dur = fmtDuration_(Date.now() - started);
    const stamp = nowStamp_();
    writeCommentaryCol_(row.row, 3, `✓ ${getModel_()} ${stamp}`);       // C: Status
    writeCommentaryCol_(row.row, 5, "");                                // E: clear Error
    const tail = split.thinking ? " · thought-trace split to G" : "";
    toast_(`✓ ${label} — ${dur}${tail}`, "📊 TPO · Done", 3);
    Logger.log(`✓ ${view} in ${dur}${tail ? " (thought split)" : ""}`);
    return { done: false, ok: true, view, durationMs: Date.now() - started };
  } catch (e) {
    const msg = String(e.message || e);
    writeCommentaryCol_(row.row, 5, msg.split("\n")[0].slice(0, 240));  // E: Error
    writeCommentaryCol_(row.row, 3, `failed`);                          // C: Status
    const dur = fmtDuration_(Date.now() - started);
    toast_(`✗ ${label} — failed (${dur}). Will retry next tick.`, "📊 TPO · Error", 5);
    Logger.log(`✗ ${view} after ${dur}: ${msg}`);
    return { done: false, ok: false, view, error: msg };
  }
}

// ---------- trigger plumbing ----------
function installResumableTrigger_() {
  // Idempotent: install only one trigger.
  const existing = ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === COMMENTARY_TRIGGER_HANDLER);
  existing.forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger(COMMENTARY_TRIGGER_HANDLER)
    .timeBased()
    .everyMinutes(1)
    .create();
}

function uninstallResumableTrigger_() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === COMMENTARY_TRIGGER_HANDLER)
    .forEach(t => ScriptApp.deleteTrigger(t));
}

function isResumableTriggerInstalled_() {
  return ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === COMMENTARY_TRIGGER_HANDLER);
}

// Time-driven entry point. ALWAYS silent (no toasts — they'd spam the sheet).
// Schedules the next tick by re-installing itself if there's still work.
function triggerTickResumable_() {
  try {
    const result = runOnePending_({ silent: true });
    if (result.done) {
      uninstallResumableTrigger_();
      Logger.log("triggerTickResumable_: all done, uninstalled trigger");
    }
  } catch (e) {
    // Never let an unhandled error kill the trigger chain.
    Logger.log("triggerTickResumable_ error: " + (e.message || e));
  }
}

// ---------- menu handlers ----------
function menuResumeCommentary() {
  const ui = SpreadsheetApp.getUi();
  if (!getApiKey_()) {
    ui.alert("📊 TPO", "No Gemini API key configured.\n\nOpen Settings… to add one.", ui.ButtonSet.OK);
    openSettings();
    return;
  }
  ensureRowsForAllTasks_();
  const rows = readCommentaryRows_();
  const pending = rows.filter(r => !r.status).length;
  const done    = rows.length - pending;
  if (pending === 0) {
    ui.alert("📊 TPO · Commentary", `All ${rows.length} briefings already generated.\n\nUse "Reset Commentary Status" to regenerate.`, ui.ButtonSet.OK);
    return;
  }
  const ok = ui.alert(
    "📊 TPO · Resume Commentary",
    `Model: ${getModel_()}\nDone: ${done} · Pending: ${pending}\n\n` +
    `This will process ONE briefing now, then auto-resume every minute via a ` +
    `time-driven trigger (safe under the 6-minute Apps Script cap).\n\nProceed?`,
    ui.ButtonSet.YES_NO,
  );
  if (ok !== ui.Button.YES) return;

  // Process one immediately, then ensure the trigger is installed for the rest.
  const result = runOnePending_({ silent: false });
  if (!result.done) installResumableTrigger_();
  ui.alert(
    "📊 TPO · Commentary",
    result.ok
      ? `Processed 1 briefing (${humanViewName_(result.view)}).\n\n` +
        (pending - 1 > 0
          ? `Remaining ${pending - 1} will process in the background (1/min). ` +
            `You'll see toasts each time. To stop early: Pause Commentary.`
          : `All done.`)
      : `Failed: ${humanViewName_(result.view)}\n\n` +
        `It will be retried automatically on the next trigger tick (in ~1 minute). ` +
        `Check the Error column for details.`,
    ui.ButtonSet.OK,
  );
}

function menuPauseCommentary() {
  uninstallResumableTrigger_();
  toast_("Commentary trigger paused. Status cells preserved.", "📊 TPO · Paused", 4);
}

function menuResetCommentaryStatus() {
  const ui = SpreadsheetApp.getUi();
  const ok = ui.alert(
    "📊 TPO · Reset",
    "Clear all Status / Started / Error / Attempts cells?\n\nCommentary text is kept unless you also clear column B manually.",
    ui.ButtonSet.YES_NO,
  );
  if (ok !== ui.Button.YES) return;
  ensureCommentarySchema_();
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TABS.COMMENTARY);
  const n = Math.max(0, sh.getLastRow() - 1);
  if (n > 0) {
    sh.getRange(2, 3, n, 4).clearContent(); // cols C..F
  }
  toast_("Status cleared. Use Resume Commentary to regenerate.", "📊 TPO · Reset", 4);
}

// Legacy: still try to do everything in one go (will 6-min-time-out on long
// lists, but useful when only 1–2 briefings are missing).
function menuGenerateCommentary() {
  const ui = SpreadsheetApp.getUi();
  if (!getApiKey_()) {
    ui.alert("📊 TPO", "No Gemini API key configured.\n\nOpen Settings… to add one.", ui.ButtonSet.OK);
    openSettings();
    return;
  }
  ensureRowsForAllTasks_();
  const rows = readCommentaryRows_();
  const pending = rows.filter(r => !r.status).length;
  if (pending === 0) {
    ui.alert("📊 TPO", `Nothing pending (${rows.length} rows already done).`, ui.ButtonSet.OK);
    return;
  }
  const ok = ui.alert(
    "📊 TPO · Force All (legacy)",
    `Process all ${pending} pending briefings in ONE run using ${getModel_()}?\n\n` +
    `⚠ Will hit the 6-minute Apps Script timeout if you have many pending. ` +
    `Prefer "Generate Commentary (Resume)…" for safe batched generation.`,
    ui.ButtonSet.YES_NO,
  );
  if (ok !== ui.Button.YES) return;

  const t0 = Date.now();
  let okCount = 0, failCount = 0, processed = 0;
  const t0Hard = Date.now();
  // Soft cap at 5 minutes to avoid the 6-min hard kill.
  while (Date.now() - t0Hard < 5 * 60 * 1000) {
    const result = runOnePending_({ silent: false });
    processed++;
    if (result.done) break;
    if (result.ok) okCount++; else failCount++;
  }
  const remaining = readCommentaryRows_().filter(r => !r.status).length;
  ui.alert(
    "📊 TPO · Commentary",
    `Processed ${processed} in ${fmtDuration_(Date.now() - t0)} using ${getModel_()}.\n` +
    `✓ ${okCount} · ✗ ${failCount}\n` +
    (remaining > 0
      ? `\n${remaining} still pending. Use Resume Commentary to continue in the background.`
      : `\nAll done.`),
    ui.ButtonSet.OK,
  );
}

// Map the internal view slug (used as the Commentary tab key) to a friendly
// label shown in the toast.
function humanViewName_(slug) {
  const map = {
    "overview":              "Overview",
    "seasonality":           "Seasonality",
    "working-capital":       "Working Capital",
    "financial-performance": "Financial Performance",
    "forward-looking":       "Forward-Looking",
  };
  if (map[slug]) return map[slug];
  // customer slugs come in lowercased with dashes; render them Title Case
  return slug.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function testGeminiConnection() {
  const ui = SpreadsheetApp.getUi();
  if (!getApiKey_()) {
    ui.alert("📊 TPO", "No Gemini API key configured.\n\nOpen Settings… to add one.", ui.ButtonSet.OK);
    return;
  }
  const model = getModel_();
  try {
    const t0 = Date.now();
    const reply = callLLM_('Reply with exactly: "ok"');
    ui.alert(
      "📊 TPO · Connection",
      `Model: ${model}\nReply: ${reply}\nLatency: ${Date.now()-t0} ms`,
      ui.ButtonSet.OK,
    );
  } catch (e) {
    ui.alert("📊 TPO · Connection FAILED", `${model}\n\n${e.message}`, ui.ButtonSet.OK);
  }
}

function showCurrentSettings() {
  const ui = SpreadsheetApp.getUi();
  const has = !!getApiKey_();
  const provider = getProvider_();
  const endpoint = getEndpoint_() || "—";
  const rl = getRateLimit_();
  ui.alert(
    "📊 TPO · Current Settings",
    `Provider: ${provider}` + (provider !== "gemini" ? `\nEndpoint: ${endpoint}` : "") +
    `\nAPI key: ${has ? "✓ set (" + getApiKey_().length + " chars)" : "✗ not set"}` +
    `\nModel: ${getModel_()}` +
    `\nCustom model: ${props_().getProperty("LLM_CUSTOM_MODEL") || props_().getProperty("GEMINI_CUSTOM_MODEL") || "—"}` +
    `\nRate-limit sequence: ${rl === "on" ? "ON (backoff 1.5s → 3s → 6s …)" : "OFF (retry immediately, respect server Retry-After)"}`,
    ui.ButtonSet.OK,
  );
}

function clearApiKey() {
  const ui = SpreadsheetApp.getUi();
  const ok = ui.alert("📊 TPO", "Clear the stored Gemini API key?", ui.ButtonSet.YES_NO);
  if (ok !== ui.Button.YES) return;
  props_().deleteProperty("GEMINI_API_KEY");
  ui.alert("📊 TPO", "API key cleared.", ui.ButtonSet.OK);
}

// ---------- settings dialog (HTML service) ----------
function openSettings() {
  const html = HtmlService.createHtmlOutput(renderSettingsHtml_())
    .setWidth(520)
    .setHeight(560)
    .setTitle("📊 TPO · Settings");
  SpreadsheetApp.getUi().showModalDialog(html, "📊 TPO · Settings");
}

// Called from the HTML dialog (google.script.run). Returns current state.
function getSettingsState() {
  const provider = getProvider_();
  const key = getApiKey_();
  return {
    provider,
    endpoint: getEndpoint_(),
    providers: [
      { id: "gemini",       label: "Google Gemini"  },
      { id: "minimax",      label: "MiniMax (MiniMax)" },
      { id: "openai_compat",label: "Custom OpenAI-compatible" },
    ],
    hasKey: !!key,
    keyLength: (key || "").length,
    keyMasked: maskKey_(key || ""),
    model: getModel_(),
    customModel: props_().getProperty("LLM_CUSTOM_MODEL") || props_().getProperty("GEMINI_CUSTOM_MODEL") || "",
    models: modelsForProvider_(provider),
    defaultModel: defaultModelForProvider_(provider),
    minimaxEndpoint: MINIMAX_DEFAULT_ENDPOINT,
    rateLimit: getRateLimit_(),
    rateLimitDefault: provider === "gemini" ? "on" : "off",
  };
}

// Save settings. The key is sent over google.script.run (server-side binding).
function saveSettings(payload) {
  const p = props_();
  const provider   = String(payload.provider || "gemini").toLowerCase();
  const endpoint   = String(payload.endpoint || "").trim();
  const key        = String(payload.key  || "").trim();
  const model      = String(payload.model|| "").trim();
  const cust       = String(payload.customModel || "").trim();
  const rateLimit  = (payload.rateLimit === undefined || payload.rateLimit === null)
    ? null  // not present in payload → leave existing value alone
    : (String(payload.rateLimit).toLowerCase() === "on" ? "on" : "off");

  if (!["gemini","minimax","openai_compat"].includes(provider)) {
    throw new Error("Unknown provider: " + provider);
  }
  p.setProperty("LLM_PROVIDER", provider);

  if (provider !== "gemini") {
    // Endpoint is required for OpenAI-compatible providers.
    if (!endpoint) throw new Error("Endpoint URL is required for this provider.");
    p.setProperty("LLM_ENDPOINT", endpoint);
  } else {
    p.deleteProperty("LLM_ENDPOINT");
  }

  if (key) p.setProperty("LLM_API_KEY", key);

  if (!model) throw new Error("Model is required.");
  if (model === "__custom__") {
    if (!cust) throw new Error("Custom model id is required.");
    p.setProperty("LLM_MODEL", "__custom__");
    p.setProperty("LLM_CUSTOM_MODEL", cust);
  } else {
    p.setProperty("LLM_MODEL", model);
    p.deleteProperty("LLM_CUSTOM_MODEL");
  }

  // Only persist if the dialog actually sent a value — backwards-compatible
  // with older dialogs that don't know about the toggle.
  if (rateLimit !== null) p.setProperty("LLM_RATE_LIMIT", rateLimit);

  return {
    ok: true,
    provider: getProvider_(),
    endpoint: getEndpoint_(),
    model: getModel_(),
    hasKey: !!getApiKey_(),
    rateLimit: getRateLimit_(),
  };
}

// Test a candidate key without saving it. Caller supplies provider + endpoint +
// model (so the dialog can test against the dropdown selection, not the saved one).
function testCandidateKey(candidate, provider, endpoint, modelId, customModel) {
  const prov = String(provider || getProvider_()).toLowerCase();
  const ep   = String(endpoint || getEndpoint_() || "").trim();
  const mdl  = (modelId === "__custom__")
    ? (customModel || getModel_())
    : (modelId || getModel_());
  return testCandidateKey_(candidate, prov, ep, mdl);
}

function clearStoredKey() {
  props_().deleteProperty("LLM_API_KEY");
  props_().deleteProperty("GEMINI_API_KEY");
  return { ok: true, hasKey: false };
}

function maskKey_(k) {
  if (!k) return "";
  if (k.length <= 8) return "•".repeat(k.length);
  return k.slice(0, 4) + "•".repeat(Math.max(0, k.length - 8)) + k.slice(-4);
}

// ---------- HTML for the dialog ----------
function renderSettingsHtml_() {
  return `
<!doctype html>
<html><head>
<base target="_top">
<style>
  :root {
    --ink: #0B1F3A; --sea: #115E67; --tide: #1A8A96; --sand: #E9E2D0;
    --rule: #D9D2C0; --mute: #5B6B7E; --gold: #C9A24B; --rust: #A14B2A;
  }
  * { box-sizing: border-box; }
  body {
    font: 14px/1.5 'Inter', system-ui, sans-serif;
    color: var(--ink); background: var(--sand);
    margin: 0; padding: 22px;
  }
  h1 {
    font-family: 'Fraunces', Georgia, serif; font-weight: 700;
    font-size: 22px; margin: 0 0 4px;
  }
  .sub { color: var(--mute); font-size: 12px; margin-bottom: 18px; }
  .row { margin-bottom: 16px; }
  label { display: block; font-size: 11px; text-transform: uppercase;
          letter-spacing: .12em; color: var(--mute); margin-bottom: 6px; }
  input[type=text], input[type=password], select {
    width: 100%; padding: 10px 12px; border: 1px solid var(--rule);
    background: #fff; border-radius: 4px; font: 14px 'Inter', sans-serif;
    color: var(--ink);
  }
  input:focus, select:focus { outline: 2px solid var(--sea); outline-offset: -1px; }
  .row-inline { display: flex; gap: 10px; align-items: center; }
  .row-inline > * { flex: 1; }
  .hint { font-size: 12px; color: var(--mute); margin-top: 4px; }
  .status {
    border-radius: 4px; padding: 10px 12px; font-size: 13px;
    margin: 10px 0;
  }
  .status-ok   { background: #DCEFE6; color: #1F6B3A; border: 1px solid #A9D6B9; }
  .status-err  { background: #F4D9CF; color: #8A3415; border: 1px solid #E0A990; }
  .status-info { background: #FFF6E0; color: #6E5113; border: 1px dashed #C9A24B; }
  .actions {
    position: sticky; bottom: -22px; background: var(--sand);
    padding: 14px 0 0; margin-top: 12px;
    display: flex; gap: 8px; justify-content: flex-end;
    border-top: 1px solid var(--rule);
  }
  button {
    font: 600 13px 'Inter', sans-serif;
    padding: 9px 16px; border-radius: 4px; cursor: pointer;
    border: 1px solid transparent;
  }
  .btn-primary { background: var(--sea); color: #fff; }
  .btn-primary:hover { background: var(--tide); }
  .btn-ghost   { background: transparent; color: var(--ink); border-color: var(--rule); }
  .btn-ghost:hover { background: #fff; }
  .btn-danger  { background: transparent; color: var(--rust); border-color: var(--rust); }
  .btn-danger:hover { background: #fff; }
  button:disabled { opacity: .5; cursor: not-allowed; }
  .pill {
    display: inline-block; padding: 2px 8px; border-radius: 999px;
    background: #fff; border: 1px solid var(--rule); font-size: 11px;
    color: var(--mute); margin-left: 6px;
  }
  /* tiny confirm row (replaces window.confirm — CSP safe) */
  .confirm {
    display: flex; gap: 8px; align-items: center;
    background: #fff; border: 1px solid var(--rule); border-radius: 4px;
    padding: 8px 10px; margin-top: 6px; font-size: 12px; color: var(--mute);
  }
  /* provider radio cards */
  .provider-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .provider-card {
    display: flex; align-items: flex-start; gap: 8px;
    border: 1px solid var(--rule); border-radius: 4px;
    padding: 10px 12px; background: #fff; cursor: pointer;
    transition: border-color .15s ease, background .15s ease;
  }
  .provider-card:hover { background: #FAF7EE; }
  .provider-card input { margin: 3px 0 0; }
  .provider-card.active { border-color: var(--sea); background: #F4F9F9; }
  .provider-card .pc-label { font-weight: 600; font-size: 13px; color: var(--ink); }
  .provider-card .pc-sub   { font-size: 11px; color: var(--mute); margin-top: 2px; }
  input[type=url] {
    width: 100%; padding: 10px 12px; border: 1px solid var(--rule);
    background: #fff; border-radius: 4px; font: 14px 'Inter', sans-serif;
    color: var(--ink);
  }
</style>
</head>
<body>
  <h1>Settings</h1>
  <div class="sub">LLM provider, API key &amp; model. Stored in Script Properties.</div>

  <div id="status" class="status status-info" style="display:none"></div>

  <div class="row">
    <label>Provider</label>
    <div class="provider-row" id="providerRow"></div>
  </div>

  <div class="row" id="endpointRow">
    <label for="endpoint">Endpoint URL
      <span id="endpointHint" class="pill">—</span>
    </label>
    <input id="endpoint" type="url" placeholder="https://api.minimaxi.com/v1" autocomplete="off" spellcheck="false" />
    <div class="hint">Base URL for the OpenAI-compatible provider. Don't include the path.</div>
  </div>

  <div class="row">
    <label>API key
      <span id="keyState" class="pill">loading…</span>
    </label>
    <div class="row-inline">
      <input id="apiKey" type="password" placeholder="Paste your API key" autocomplete="off" />
      <button class="btn-ghost" id="toggleShow" type="button" style="flex:0 0 auto">Show</button>
    </div>
    <div class="hint">Leave blank to keep the currently stored key.</div>
  </div>

  <div class="row">
    <label for="model">Model</label>
    <div class="row-inline" style="align-items: stretch;">
      <select id="model" style="flex:1"></select>
      <span id="fetchModelsSlot" style="flex:0 0 auto; display:none">
        <button class="btn-ghost" id="btnFetchModels" type="button" style="white-space: nowrap;">Fetch models</button>
      </span>
    </div>
    <div class="hint" id="modelHint"></div>
  </div>

  <div class="row" id="customRow" style="display:none">
    <label for="customModel">Custom model id</label>
    <input id="customModel" type="text" placeholder="e.g. gemini-3.1-pro or MiniMax-M3" />
    <div class="hint">Use any model id your API key has access to.</div>
  </div>

  <div class="row" id="rateLimitRow">
    <label style="display:flex; align-items:center; gap:8px; text-transform:none; letter-spacing:0; color:var(--ink); font-size:13px; margin-bottom:0;">
      <input id="rateLimit" type="checkbox" style="width:auto; margin:0;" />
      <span>Rate-limit sequence (synthetic backoff between retries)
        <span id="rateLimitDefault" class="pill">default: —</span>
      </span>
    </label>
    <div class="hint">ON for Gemini free tier (1.5s → 3s → 6s …). OFF for MiniMax / paid tier (retry immediately, respect server's <code>Retry-After</code>).</div>
  </div>

  <div id="confirmSlot"></div>

  <div class="actions">
    <button class="btn-danger" id="btnClear" type="button">Clear key</button>
    <span style="flex:1"></span>
    <button class="btn-ghost" id="btnTest" type="button">Test connection</button>
    <button class="btn-primary" id="btnSave" type="button">Save</button>
  </div>

<script>
  // Surface runtime errors in the visible status banner instead of failing silently
  window.addEventListener('error', (ev) => {
    try { showStatus('JS error: ' + (ev.message || ev.error || 'unknown'), 'err'); } catch (_) {}
  });
  window.addEventListener('unhandledrejection', (ev) => {
    try { showStatus('Promise rejection: ' + (ev.reason && ev.reason.message || ev.reason), 'err'); } catch (_) {}
  });

  const state = {
    provider: "gemini",
    endpoint: "",
    providers: [],                // [{id, label}]
    modelsByProvider: {},         // {gemini: [...], minimax: [...], openai_compat: [...]}
    defaultModelByProvider: {},   // {gemini: 'gemini-2.5-flash', minimax: 'MiniMax-Text-01', ...}
    currentModels: [],
    defaultModel: "",
    model: "",
    customModel: "",
    hasKey: false, keyLength: 0, keyMasked: "",
    minimaxEndpoint: "https://api.minimaxi.com/v1",
    rateLimit: "on",
    rateLimitDefault: "on",   // updated per provider in refresh()
  };
  const $ = (id) => document.getElementById(id);

  function showStatus(msg, kind) {
    const el = $("status");
    el.className = "status status-" + kind;
    el.textContent = msg;
    el.style.display = "block";
  }
  function clearStatus() { $("status").style.display = "none"; }

  function providerLabel(id) {
    const p = state.providers.find(x => x.id === id);
    return p ? p.label : id;
  }

  function renderProviderCards() {
    const row = $("providerRow");
    row.innerHTML = "";
    state.providers.forEach(p => {
      const card = document.createElement("label");
      card.className = "provider-card" + (p.id === state.provider ? " active" : "");
      card.innerHTML =
        '<input type="radio" name="provider" value="' + p.id + '"' +
        (p.id === state.provider ? " checked" : "") + '/>' +
        '<div><div class="pc-label">' + p.label + '</div>' +
        '<div class="pc-sub">' + (
          p.id === "gemini"        ? "Google AI Studio key" :
          p.id === "minimax"       ? "MiniMax M3 / M-series (OpenAI-compatible)" :
          p.id === "openai_compat" ? "OpenAI, Groq, Together, …" : ""
        ) + '</div></div>';
      card.querySelector("input").addEventListener("change", async (e) => {
        if (!e.target.checked) return;
        state.provider = e.target.value;
        renderProviderCards();
        await onProviderChange();
      });
      row.appendChild(card);
    });
  }

  async function onProviderChange() {
    const showEndpoint = state.provider !== "gemini";
    $("endpointRow").style.display = showEndpoint ? "" : "none";
    $("endpointHint").textContent = showEndpoint
      ? (state.provider === "minimax" ? "Default: " + state.minimaxEndpoint : "Custom OpenAI-compatible endpoint")
      : "Not used for Gemini";

    // Pre-fill endpoint if blank and we have a sensible default
    if (showEndpoint && !$("endpoint").value.trim()) {
      $("endpoint").value = state.provider === "minimax" ? state.minimaxEndpoint : "";
    }

    // Ensure the model list for this provider is loaded — otherwise
    // switching to MiniMax on a fresh dialog leaves the dropdown empty.
    if (!state.modelsByProvider[state.provider]) {
      await loadModelsForProvider(state.provider);
    }
    state.defaultModel = state.defaultModelByProvider[state.provider] || "";
    state.currentModels = state.modelsByProvider[state.provider] || [];
    if (!state.model || (!state.currentModels.some(m => m.id === state.model) && state.model !== "__custom__")) {
      state.model = state.defaultModel;
    }
    renderModels();
    // Show / hide the "Fetch models" button (non-Gemini only)
    $("fetchModelsSlot").style.display = (state.provider !== "gemini") ? "" : "none";
    // Rate-limit default follows the provider unless the user has set a value
    state.rateLimitDefault = state.provider === "gemini" ? "on" : "off";
    refreshRateLimitUi_();
  }

  function refreshRateLimitUi_() {
    // Only auto-set the checkbox if the user hasn't explicitly diverged from
    // the previous default — keeps their choice sticky across provider switches.
    const def = state.rateLimitDefault;
    $("rateLimitDefault").textContent = "default: " + (def === "on" ? "ON" : "OFF");
    $("rateLimit").checked = state.rateLimit === "on";
  }

  function fetchModelsForProvider(provider) {
    return new Promise((resolve, reject) => {
      google.script.run
        .withSuccessHandler(s => resolve(s || {}))
        .withFailureHandler(err => reject(err))
        .getModelsForProvider(provider);
    });
  }

  async function loadModelsForProvider(provider) {
    try {
      const s = await fetchModelsForProvider(provider);
      state.modelsByProvider[provider] = s.models || [];
      state.defaultModelByProvider[provider] = s.defaultModel || "";
      return true;
    } catch (e) {
      showStatus("Failed to load models: " + (e.message || e), "err");
      return false;
    }
  }

  function currentSelection() {
    // Always read the live select value, not a cached state field.
    const sel = $("model");
    return sel.value || (sel.options[0] && sel.options[0].value) || "";
  }

  function renderModels() {
    const sel = $("model");
    sel.innerHTML = "";
    const targetModel = state.model || state.defaultModel;
    state.currentModels = state.modelsByProvider[state.provider] || [];

    // If the saved model isn't in the registry (e.g. a previous custom value),
    // add it at the top so the dropdown actually reflects what's saved.
    if (targetModel && !state.currentModels.some(m => m.id === targetModel)) {
      const savedOpt = document.createElement("option");
      savedOpt.value = targetModel;
      savedOpt.textContent = targetModel + " (saved)";
      sel.appendChild(savedOpt);
    }

    state.currentModels.forEach(m => {
      const opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = m.label;
      sel.appendChild(opt);
      // Set selected AFTER the option is in the select. (Setting it before
      // appendChild is silently ignored by browsers — this was a bug pre-fix.)
      if (m.id === targetModel) opt.selected = true;
    });

    if (sel.value !== targetModel) {
      for (let i = 0; i < sel.options.length; i++) {
        if (sel.options[i].value === targetModel) {
          sel.options[i].selected = true;
          break;
        }
      }
    }
    onModelChange();
  }

  function onModelChange() {
    const v = currentSelection();
    const m = state.currentModels.find(x => x.id === v);
    $("modelHint").textContent = m ? m.hint : "";
    $("customRow").style.display = v === "__custom__" ? "" : "none";
  }

  async function refresh() {
    showStatus("Loading settings…", "info");
    try {
      const s = await new Promise((resolve, reject) => {
        google.script.run
          .withSuccessHandler(resolve)
          .withFailureHandler(reject)
          .getSettingsState();
      });

      state.provider     = s.provider || "gemini";
      state.endpoint     = s.endpoint || "";
      state.providers    = s.providers || [];
      state.model        = s.model || s.defaultModel || "";
      state.customModel  = s.customModel || "";
      state.hasKey       = !!s.hasKey;
      state.keyLength    = s.keyLength || 0;
      state.keyMasked    = s.keyMasked || "";
      state.minimaxEndpoint = s.minimaxEndpoint || "https://api.minimaxi.com/v1";
      state.rateLimit        = s.rateLimit || s.rateLimitDefault || "on";
      state.rateLimitDefault = s.rateLimitDefault || (state.provider === "gemini" ? "on" : "off");

      renderProviderCards();
      $("endpoint").value = state.endpoint;

      // Load models for current provider (then update dropdown)
      await loadModelsForProvider(state.provider);
      state.defaultModel = state.defaultModelByProvider[state.provider] || "";
      renderModels();

      if (state.model === "__custom__" && state.customModel) {
        $("customModel").value = state.customModel;
      }

      $("keyState").textContent = state.hasKey
        ? "✓ set (" + state.keyLength + " chars · " + state.keyMasked + ")"
        : "✗ not set";
      onProviderChange();   // sets endpoint visibility + hint + model reset
      showStatus("Loaded.", "info");
    } catch (err) {
      showStatus("Failed to load settings: " + (err.message || err), "err");
    }
  }

  function confirmInline(message, onYes) {
    const slot = $("confirmSlot");
    slot.innerHTML = "";
    const row = document.createElement("div");
    row.className = "confirm";
    row.appendChild(document.createTextNode(message + " "));
    const yes = document.createElement("button");
    yes.className = "btn-ghost"; yes.textContent = "Yes";
    yes.addEventListener("click", () => { slot.innerHTML = ""; onYes(); });
    const no = document.createElement("button");
    no.className = "btn-ghost"; no.textContent = "Cancel";
    no.addEventListener("click", () => { slot.innerHTML = ""; });
    row.appendChild(yes); row.appendChild(no);
    slot.appendChild(row);
  }

  // ---- event wiring ----
  $("toggleShow").addEventListener("click", () => {
    const inp = $("apiKey");
    const isPw = inp.type === "password";
    inp.type = isPw ? "text" : "password";
    $("toggleShow").textContent = isPw ? "Hide" : "Show";
  });

  $("model").addEventListener("change", () => {
    // Keep state.model in sync so refresh() / save validation use the right value.
    state.model = currentSelection();
    onModelChange();
  });
  $("customModel").addEventListener("input", (e) => {
    state.customModel = e.target.value.trim();
  });
  $("endpoint").addEventListener("input", (e) => {
    state.endpoint = e.target.value.trim();
  });
  $("rateLimit").addEventListener("change", (e) => {
    state.rateLimit = e.target.checked ? "on" : "off";
  });

  $("btnFetchModels").addEventListener("click", async () => {
    clearStatus();
    const endpoint = $("endpoint").value.trim();
    const typedKey = $("apiKey").value.trim();
    if (!endpoint) {
      showStatus("Endpoint URL is required to fetch models.", "err");
      return;
    }
    if (!typedKey && !state.hasKey) {
      showStatus("Paste a key first (or save one) before fetching models.", "err");
      return;
    }
    $("btnFetchModels").disabled = true;
    $("btnFetchModels").textContent = "Fetching…";
    try {
      const s = await new Promise((resolve, reject) => {
        const runner = typedKey
          ? google.script.run.fetchEndpointModels(endpoint, typedKey, state.provider)
          : google.script.run.fetchEndpointModels(endpoint, null, state.provider);
        runner.withSuccessHandler(resolve).withFailureHandler(reject);
      });
      if (!s.ok) {
        showStatus("Fetch failed · HTTP " + (s.code || "?") + " · " + (s.message || ""), "err");
        return;
      }
      const models = s.models || [];
      if (!models.length) {
        showStatus("Endpoint returned no models.", "err");
        return;
      }
      // Merge fetched models into the provider's registry; keep a marker so we
      // know these came from the live API (and prepend them, since the user
      // explicitly fetched them).
      state.modelsByProvider[state.provider] = models;
      // Pick a default: prefer provider default if it's in the list, else first.
      const desired = state.defaultModelByProvider[state.provider] || "";
      const def = models.find(m => m.id === desired) ? desired : models[0].id;
      state.defaultModelByProvider[state.provider] = def;
      state.model = def;
      state.defaultModel = def;
      renderModels();
      showStatus("Fetched " + models.length + " models · default = " + def, "ok");
    } catch (err) {
      showStatus("Fetch error: " + (err.message || err), "err");
    } finally {
      $("btnFetchModels").disabled = false;
      $("btnFetchModels").textContent = "Fetch models";
    }
  });

  $("btnTest").addEventListener("click", async () => {
    clearStatus();
    const key      = $("apiKey").value.trim();
    const model    = currentSelection();
    const custom   = $("customModel").value.trim();
    const endpoint = $("endpoint").value.trim();

    if (!key && !state.hasKey) {
      showStatus("Paste a key first (or save one) before testing.", "err");
      return;
    }
    const modelToTest = (model === "__custom__") ? custom : model;
    if (model === "__custom__" && !custom) {
      showStatus("Type the custom model id first.", "err");
      return;
    }
    if (state.provider !== "gemini" && !endpoint) {
      showStatus("Endpoint URL is required for " + providerLabel(state.provider) + ".", "err");
      return;
    }

    $("btnTest").disabled = true;
    $("btnTest").textContent = "Testing…";

    const finish = (r) => {
      $("btnTest").disabled = false; $("btnTest").textContent = "Test connection";
      if (r && r.ok) showStatus("Connection OK · " + modelToTest + ' replied: "' + r.reply + '"', "ok");
      else          showStatus("Connection FAILED · " + modelToTest + " · HTTP " + (r && r.code) + " · " + (r && r.message), "err");
    };
    const fail = (err) => {
      $("btnTest").disabled = false; $("btnTest").textContent = "Test connection";
      showStatus("Test error: " + (err.message || err), "err");
    };

    if (key) google.script.run.withSuccessHandler(finish).withFailureHandler(fail)
      .testCandidateKey(key, state.provider, endpoint, model, custom);
    else     google.script.run.withSuccessHandler(finish).withFailureHandler(fail)
      .testStoredKey();
  });

  $("btnSave").addEventListener("click", () => {
    clearStatus();
    const model    = currentSelection();
    const custom   = $("customModel").value.trim();
    const endpoint = $("endpoint").value.trim();

    if (!model) { showStatus("Pick a model first.", "err"); return; }
    if (model === "__custom__" && !custom) {
      showStatus("Type the custom model id first.", "err"); return;
    }
    if (state.provider !== "gemini" && !endpoint) {
      showStatus("Endpoint URL is required for " + providerLabel(state.provider) + ".", "err"); return;
    }

    const payload = {
      provider:    state.provider,
      endpoint:    endpoint,
      key:         $("apiKey").value.trim(),
      model:       model,
      customModel: custom,
      rateLimit:   $("rateLimit").checked ? "on" : "off",
    };

    $("btnSave").disabled = true;
    $("btnSave").textContent = "Saving…";
    google.script.run
      .withSuccessHandler(r => {
        $("btnSave").disabled = false; $("btnSave").textContent = "Save";
        if (r && r.ok) {
          showStatus("Saved · " + providerLabel(r.provider) + " · " + r.model +
                     " · rate-limit " + (r.rateLimit === "on" ? "ON" : "OFF") +
                     (r.hasKey ? " · key stored" : " (no new key)"), "ok");
          $("apiKey").value = "";
          refresh();
        } else {
          showStatus("Save failed: " + (r && r.message || "unknown"), "err");
        }
      })
      .withFailureHandler(err => {
        $("btnSave").disabled = false; $("btnSave").textContent = "Save";
        showStatus("Save failed: " + (err.message || err), "err");
      })
      .saveSettings(payload);
  });

  $("btnClear").addEventListener("click", () => {
    confirmInline("Clear the stored API key?", () => {
      google.script.run
        .withSuccessHandler(() => { showStatus("API key cleared.", "ok"); refresh(); })
        .withFailureHandler(err => showStatus("Clear failed: " + (err.message || err), "err"))
        .clearStoredKey();
    });
  });

  refresh();
</script>
</body></html>`;
}

// Server-side wrapper to test the stored key (called from the dialog when
// the user clicks "Test connection" without typing a new key).
function testStoredKey() {
  const key = getApiKey_();
  if (!key) return { ok: false, code: 0, message: "No key stored." };
  return testCandidateKey_(key, getProvider_(), getEndpoint_(), getModel_());
}

// Dispatch by provider; returns {ok, reply, code, message}.
function testCandidateKey_(candidate, provider, endpoint, model) {
  try {
    if (provider === "minimax" || provider === "openai_compat") {
      const url = `${String(endpoint || "").replace(/\/+$/, "")}/chat/completions`;
      const body = {
        model,
        messages: [{ role: "user", content: 'Reply with exactly: "ok"' }],
        max_tokens: 8,
        temperature: 0,
        stream: false,
      };
      const res = UrlFetchApp.fetch(url, {
        method: "post",
        contentType: "application/json",
        headers: { "Authorization": "Bearer " + candidate },
        payload: JSON.stringify(body),
        muteHttpExceptions: true,
      });
      if (res.getResponseCode() !== 200) {
        return { ok: false, code: res.getResponseCode(), message: res.getContentText().slice(0, 400) };
      }
      const json = JSON.parse(res.getContentText());
      const text = json?.choices?.[0]?.message?.content || "";
      return { ok: true, reply: String(text).trim(), code: 200 };
    }
    // Default: Gemini
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(candidate)}`;
    const body = { contents: [{ parts: [{ text: 'Reply with exactly: "ok"' }] }], generationConfig: { maxOutputTokens: 8 } };
    const res = UrlFetchApp.fetch(url, { method: "post", contentType: "application/json", payload: JSON.stringify(body), muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) {
      return { ok: false, code: res.getResponseCode(), message: res.getContentText().slice(0, 400) };
    }
    const json = JSON.parse(res.getContentText());
    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    return { ok: true, reply: String(text).trim(), code: 200 };
  } catch (e) {
    return { ok: false, code: 0, message: e.message || String(e) };
  }
}