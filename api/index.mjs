// server.ts
import express from "express";
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { Type } from "@google/genai";
import { evaluate } from "mathjs";

// server/geminiResilience.ts
import { GoogleGenAI } from "@google/genai";
var PRIMARY_GEMINI_MODEL = "gemini-3.8-flash";
var FALLBACK_FLASH_CANDIDATES = [
  "gemini-4-hydrogen",
  "gemini-3.1-flash-lite",
  "gemini-3.7-flash",
  "gemini-3-flash-preview"
];
var BACKOFF_SCHEDULE_MS = [650, 1400];
var MAX_PRIMARY_RETRIES = 1;
var DEFAULT_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS || 2e4);
var DEFAULT_FIRST_TOKEN_TIMEOUT_MS = Number(process.env.GEMINI_FIRST_TOKEN_TIMEOUT_MS || 11e3);
var PRIMARY_COOLDOWN_MS = 6e4;
var FALLBACK_CACHE_TTL_MS = 10 * 6e4;
var circuitState = {
  primaryCooldownUntil: 0,
  verifiedFallbackModels: [],
  verifiedFallbackExpiresAt: 0,
  unavailableModelsUntil: /* @__PURE__ */ new Map()
};
function getResilienceStateSnapshot(now = Date.now()) {
  return {
    primaryInCooldown: now < circuitState.primaryCooldownUntil,
    primaryCooldownRemainingMs: Math.max(0, circuitState.primaryCooldownUntil - now),
    verifiedFallbackModels: [...circuitState.verifiedFallbackModels]
  };
}
function sanitizeSecret(text) {
  if (!text) return "";
  return text.replace(/AIza[0-9A-Za-z_-]{20,}/g, "[REDACTED_KEY]").replace(/(key|apiKey|api_key|token|authorization)\s*[:=]\s*['"]?[A-Za-z0-9._-]{12,}['"]?/gi, "$1=[REDACTED]");
}
function getConfiguredGeminiKey() {
  const val = process.env.GEMINI_API_KEY;
  if (typeof val === "string") {
    const trimmed = val.trim();
    if (trimmed.length > 0 && trimmed !== "MY_GEMINI_API_KEY") {
      return { apiKey: trimmed, envVarName: "GEMINI_API_KEY" };
    }
  }
  return { apiKey: null, envVarName: null };
}
function createGeminiClient() {
  const { apiKey } = getConfiguredGeminiKey();
  if (!apiKey) {
    const err = new Error("GEMINI_API_KEY is not configured in environment.");
    err.status = 401;
    err.code = "API_KEY_MISSING";
    throw err;
  }
  return new GoogleGenAI({
    apiKey,
    apiVersion: "v1beta",
    httpOptions: {
      headers: {
        "User-Agent": "physics-smart-aistudio"
      }
    }
  });
}
function extractHttpStatus(err) {
  const candidates = [
    err?.status,
    err?.statusCode,
    err?.data$?.httpMeta?.response?.status,
    err?.data$?.error?.code,
    err?.error?.code,
    err?.response?.status,
    err?.response?.data?.error?.code,
    err?.body?.error?.code,
    err?.cause?.status
  ];
  for (const val of candidates) {
    if (typeof val === "number" && val >= 100 && val < 600) {
      return val;
    }
  }
  const msg = String(err?.message || err?.data$?.error?.message || err?.cause?.message || "");
  const match = msg.match(/\b(400|401|403|404|408|422|429|500|502|503|504)\b/);
  if (match) return Number(match[1]);
  return 0;
}
function extractRawErrorMessage(err) {
  const parts = [
    err?.data$?.error?.message,
    err?.response?.data?.error?.message,
    err?.body?.error?.message,
    err?.error?.message,
    err?.message,
    err?.cause?.message,
    err?.data$?.error?.status,
    err?.statusText,
    err?.code,
    err?.cause?.code,
    err?.name
  ].filter((x) => typeof x === "string" && x.trim().length > 0);
  return sanitizeSecret(parts.join(" | ") || String(err || "Unknown error"));
}
function classifyGeminiError(err) {
  const status = extractHttpStatus(err);
  const rawSummary = extractRawErrorMessage(err);
  const lower = rawSummary.toLowerCase();
  if (status === 401 || lower.includes("api_key_invalid") || lower.includes("api key not valid") || lower.includes("unauthenticated") || lower.includes("api_key_missing") || lower.includes("not configured in environment")) {
    return {
      category: "auth_error",
      httpStatus: 401,
      retryableOnSameModel: false,
      triggersFallback: false,
      safeMessage: lower.includes("api_key_missing") || lower.includes("not configured in environment") ? "\u0645\u0641\u062A\u0627\u062D GEMINI_API_KEY \u063A\u064A\u0631 \u0645\u0636\u0627\u0641 \u0641\u064A \u0628\u064A\u0626\u0629 \u0627\u0644\u062A\u0634\u063A\u064A\u0644 \u0639\u0644\u0649 \u0627\u0644\u062E\u0627\u062F\u0645." : "\u0645\u0641\u062A\u0627\u062D Gemini API \u063A\u064A\u0631 \u0635\u0627\u0644\u062D \u0623\u0648 \u0645\u0631\u0641\u0648\u0636 \u0645\u0646 Google (401). \u064A\u0631\u062C\u0649 \u0625\u0646\u0634\u0627\u0621 \u0645\u0641\u062A\u0627\u062D \u0635\u062D\u064A\u062D \u0645\u0646 Google AI Studio \u0648\u062A\u062D\u062F\u064A\u062B\u0647 \u0641\u064A Vercel.",
      rawSummary
    };
  }
  if (status === 403 || lower.includes("permission_denied") || lower.includes("forbidden")) {
    return {
      category: "permission_denied",
      httpStatus: 403,
      retryableOnSameModel: false,
      triggersFallback: false,
      safeMessage: "\u0645\u0641\u062A\u0627\u062D Gemini \u0645\u0648\u062C\u0648\u062F \u0644\u0643\u0646\u0647 \u0644\u0627 \u064A\u0645\u0644\u0643 \u0627\u0644\u0635\u0644\u0627\u062D\u064A\u0627\u062A \u0627\u0644\u0645\u0637\u0644\u0648\u0628\u0629 \u0623\u0648 \u0639\u0644\u064A\u0647 \u0642\u064A\u0648\u062F \u062A\u0645\u0646\u0639 \u0627\u0644\u0627\u0633\u062A\u062E\u062F\u0627\u0645 (403). \u062A\u062D\u0642\u0642 \u0645\u0646 \u062A\u0641\u0639\u064A\u0644 Gemini API \u0648\u0627\u0644\u0642\u064A\u0648\u062F \u0641\u064A Google AI Studio / Cloud Console.",
      rawSummary
    };
  }
  if (err?.code === "EMPTY_RESPONSE" || lower.includes("empty_response")) {
    return {
      category: "empty_response",
      httpStatus: 502,
      retryableOnSameModel: true,
      triggersFallback: true,
      safeMessage: "\u0644\u0645 \u062A\u0643\u062A\u0645\u0644 \u0627\u0644\u0625\u062C\u0627\u0628\u0629 \u0628\u0634\u0643\u0644 \u0635\u062D\u064A\u062D\u060C \u064A\u0631\u062C\u0649 \u0625\u0639\u0627\u062F\u0629 \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629.",
      rawSummary
    };
  }
  if (status === 404 || lower.includes("not_found") || lower.includes("no longer available") || lower.includes("model not found")) {
    return {
      category: "model_unavailable",
      httpStatus: 404,
      retryableOnSameModel: false,
      triggersFallback: true,
      safeMessage: "\u0627\u0644\u0646\u0645\u0648\u0630\u062C \u0627\u0644\u0623\u0633\u0627\u0633\u064A \u063A\u064A\u0631 \u0645\u062A\u0627\u062D \u062D\u0627\u0644\u064A\u064B\u0627\u060C \u062C\u0627\u0631\u064D \u0627\u0644\u062A\u062D\u0648\u064A\u0644 \u0644\u0644\u0628\u062F\u064A\u0644.",
      rawSummary
    };
  }
  if ((status === 400 || status === 422 || lower.includes("invalid_argument")) && (lower.includes("unable to process input") || lower.includes("document has no pages") || lower.includes("pdf") || lower.includes("image") || lower.includes("mime") || lower.includes("unsupported content") || lower.includes("corrupt") || lower.includes("password") || lower.includes("file uri") || lower.includes("not active"))) {
    return {
      category: "attachment_rejected",
      httpStatus: 422,
      retryableOnSameModel: false,
      triggersFallback: false,
      safeMessage: "\u0631\u0641\u0636 \u062E\u0627\u062F\u0645 \u0627\u0644\u0630\u0643\u0627\u0621 \u0627\u0644\u0627\u0635\u0637\u0646\u0627\u0639\u064A \u0642\u0631\u0627\u0621\u0629 \u0627\u0644\u0645\u0644\u0641 \u0627\u0644\u0645\u0631\u0641\u0642 (\u0642\u062F \u064A\u0643\u0648\u0646 \u062A\u0627\u0644\u0641\u064B\u0627 \u0623\u0648 \u0645\u0634\u0641\u0651\u0631\u064B\u0627 \u0623\u0648 \u0628\u0635\u064A\u063A\u0629 \u063A\u064A\u0631 \u0645\u062F\u0639\u0648\u0645\u0629). \u064A\u0631\u062C\u0649 \u062A\u062C\u0631\u0628\u0629 \u0645\u0644\u0641 \u0623\u0648 \u0635\u0648\u0631\u0629 \u0623\u0648\u0636\u062D.",
      rawSummary
    };
  }
  if (status === 400 || status === 422 || lower.includes("invalid_argument") || lower.includes("failed_precondition")) {
    return {
      category: "bad_request",
      httpStatus: 400,
      retryableOnSameModel: false,
      triggersFallback: false,
      safeMessage: "\u062A\u0639\u0630\u0631 \u0645\u0639\u0627\u0644\u062C\u0629 \u0635\u064A\u063A\u0629 \u0627\u0644\u0633\u0624\u0627\u0644 \u0623\u0648 \u0627\u0644\u0645\u0631\u0641\u0642 \u0627\u0644\u062D\u0627\u0644\u064A. \u064A\u0631\u062C\u0649 \u0645\u0631\u0627\u062C\u0639\u0629 \u0627\u0644\u0645\u062F\u062E\u0644\u0627\u062A \u0648\u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629 \u0645\u0631\u0629 \u0623\u062E\u0631\u0649.",
      rawSummary
    };
  }
  if (status === 503 || lower.includes("high demand") || lower.includes("unavailable") || lower.includes("overloaded") || lower.includes("service unavailable")) {
    return {
      category: "high_demand",
      httpStatus: 503,
      retryableOnSameModel: true,
      triggersFallback: true,
      safeMessage: "\u0627\u0644\u0645\u062F\u0631\u0633 \u0627\u0644\u0630\u0643\u064A \u064A\u0648\u0627\u062C\u0647 \u0636\u063A\u0637\u064B\u0627 \u0645\u0624\u0642\u062A\u064B\u0627 \u062D\u0627\u0644\u064A\u064B\u0627. \u0633\u0624\u0627\u0644\u0643 \u0645\u062D\u0641\u0648\u0638\u060C \u064A\u0631\u062C\u0649 \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629 \u0628\u0639\u062F \u0644\u062D\u0638\u0627\u062A.",
      rawSummary
    };
  }
  if (status === 429 || lower.includes("resource_exhausted") || lower.includes("rate limit") || lower.includes("too many requests")) {
    return {
      category: "rate_limit",
      httpStatus: 429,
      retryableOnSameModel: true,
      triggersFallback: true,
      safeMessage: "\u0627\u0644\u0645\u062F\u0631\u0633 \u0627\u0644\u0630\u0643\u064A \u064A\u0648\u0627\u062C\u0647 \u0636\u063A\u0637\u064B\u0627 \u0645\u0624\u0642\u062A\u064B\u0627 \u0641\u064A \u0627\u0644\u0637\u0644\u0628\u0627\u062A. \u064A\u0631\u062C\u0649 \u0625\u0639\u0627\u062F\u0629 \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629 \u0628\u0639\u062F \u062B\u0648\u0627\u0646\u064D.",
      rawSummary
    };
  }
  if (status === 408 || status === 504 || lower.includes("timeout") || lower.includes("timed out") || lower.includes("aborterror") || lower.includes("etimedout")) {
    return {
      category: "timeout",
      httpStatus: 504,
      retryableOnSameModel: true,
      triggersFallback: true,
      safeMessage: "\u0627\u0633\u062A\u063A\u0631\u0642 \u0627\u0644\u0627\u062A\u0635\u0627\u0644 \u0648\u0642\u062A\u064B\u0627 \u0623\u0637\u0648\u0644 \u0645\u0646 \u0627\u0644\u0645\u0639\u062A\u0627\u062F. \u064A\u0631\u062C\u0649 \u0627\u0644\u0636\u063A\u0637 \u0639\u0644\u0649 \u0625\u0639\u0627\u062F\u0629 \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629.",
      rawSummary
    };
  }
  if (status === 500 || status === 502 || lower.includes("internal")) {
    return {
      category: "server_error",
      httpStatus: status || 500,
      retryableOnSameModel: true,
      triggersFallback: true,
      safeMessage: "\u062D\u062F\u062B \u062E\u0644\u0644 \u0645\u0624\u0642\u062A \u0641\u064A \u0627\u0644\u062E\u062F\u0645\u0629. \u064A\u0631\u062C\u0649 \u0625\u0639\u0627\u062F\u0629 \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629.",
      rawSummary
    };
  }
  if (lower.includes("econnreset") || lower.includes("econnrefused") || lower.includes("enotfound") || lower.includes("eai_again") || lower.includes("fetch failed") || lower.includes("apiconnectionerror") || lower.includes("network") || lower.includes("socket")) {
    return {
      category: "network_error",
      httpStatus: 503,
      retryableOnSameModel: true,
      triggersFallback: true,
      safeMessage: "\u062A\u0639\u0630\u0631 \u0627\u0644\u0627\u062A\u0635\u0627\u0644 \u0628\u062E\u062F\u0645\u0629 \u0627\u0644\u0630\u0643\u0627\u0621 \u0627\u0644\u0627\u0635\u0637\u0646\u0627\u0639\u064A \u0645\u0624\u0642\u062A\u064B\u0627. \u064A\u0631\u062C\u0649 \u0627\u0644\u062A\u062D\u0642\u0642 \u0645\u0646 \u0627\u0644\u0634\u0628\u0643\u0629 \u0648\u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629 \u0645\u062C\u062F\u062F\u064B\u0627.",
      rawSummary
    };
  }
  return {
    category: "unknown_error",
    httpStatus: status || 500,
    retryableOnSameModel: false,
    triggersFallback: false,
    safeMessage: "\u062A\u0639\u0630\u0631 \u0625\u0643\u0645\u0627\u0644 \u0627\u0644\u0631\u062F \u062D\u0627\u0644\u064A\u064B\u0627. \u064A\u0631\u062C\u0649 \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629 \u0645\u0631\u0629 \u0623\u062E\u0631\u0649.",
    rawSummary
  };
}
function isPreviousInteractionError(err) {
  const msg = extractRawErrorMessage(err).toLowerCase();
  return msg.includes("previous_interaction") || msg.includes("interaction not found") || msg.includes("interaction_id");
}
function computeBackoffDelayMs(retryIndex, schedule = BACKOFF_SCHEDULE_MS, jitterMaxMs = 150) {
  const base = schedule[Math.min(retryIndex, schedule.length - 1)] ?? 650;
  const jitter = jitterMaxMs > 0 ? Math.floor(Math.random() * jitterMaxMs) : 0;
  return base + jitter;
}
function extractInteractionOutputText(interaction) {
  if (!interaction) return "";
  if (typeof interaction.output_text === "string" && interaction.output_text.trim().length > 0) {
    return interaction.output_text.trim();
  }
  if (Array.isArray(interaction.steps)) {
    const chunks = [];
    for (const step of interaction.steps) {
      if (step?.type === "model_output" && Array.isArray(step.content)) {
        for (const item of step.content) {
          if (item?.type === "text" && typeof item.text === "string") {
            chunks.push(item.text);
          }
        }
      }
    }
    const combined = chunks.join("").trim();
    if (combined.length > 0) return combined;
  }
  return "";
}
function isEligibleFallbackFlashName(modelName) {
  const id = modelName.replace(/^models\//, "").toLowerCase();
  if (!id.includes("flash")) {
    if (id !== "gemini-4-hydrogen") return false;
  }
  if (id === PRIMARY_GEMINI_MODEL) return false;
  const disallowedFragments = [
    "1.5",
    "2.0",
    "2.5",
    "tts",
    "image",
    "live",
    "audio",
    "transcribe",
    "embedding",
    "omni",
    "robotics",
    "thinking"
  ];
  return !disallowedFragments.some((frag) => id.includes(frag));
}
async function resolveVerifiedFallbackModels(ai, nowFn = Date.now) {
  const now = nowFn();
  if (circuitState.verifiedFallbackModels.length > 0 && now < circuitState.verifiedFallbackExpiresAt) {
    return circuitState.verifiedFallbackModels.filter(
      (m) => (circuitState.unavailableModelsUntil.get(m) || 0) <= now
    );
  }
  const discovered = /* @__PURE__ */ new Set();
  if (ai.models?.list) {
    try {
      const pager = await ai.models.list({ config: { pageSize: 50 } });
      const items = Array.isArray(pager?.page) ? pager.page : Array.isArray(pager?.models) ? pager.models : [];
      for (const item of items) {
        const rawName = String(item?.name || item?.id || "").replace(/^models\//, "");
        if (!rawName || !isEligibleFallbackFlashName(rawName)) continue;
        const methods = Array.isArray(item?.supportedGenerationMethods) ? item.supportedGenerationMethods : [];
        if (methods.length > 0 && !methods.some((m) => /generate|interact/i.test(m))) continue;
        discovered.add(rawName);
      }
    } catch {
    }
  }
  if (discovered.size === 0 && ai.models?.get) {
    for (const candidate of FALLBACK_FLASH_CANDIDATES) {
      if ((circuitState.unavailableModelsUntil.get(candidate) || 0) > now) continue;
      try {
        const info = await ai.models.get({ model: candidate });
        if (info) {
          discovered.add(candidate);
          break;
        }
      } catch (err) {
        const classified = classifyGeminiError(err);
        if (classified.category === "model_unavailable") {
          circuitState.unavailableModelsUntil.set(candidate, now + FALLBACK_CACHE_TTL_MS);
        }
      }
    }
  }
  const ordered = [];
  for (const preferred of FALLBACK_FLASH_CANDIDATES) {
    if (discovered.has(preferred) && (circuitState.unavailableModelsUntil.get(preferred) || 0) <= now) {
      ordered.push(preferred);
    }
  }
  for (const extra of discovered) {
    if (!ordered.includes(extra) && (circuitState.unavailableModelsUntil.get(extra) || 0) <= now) {
      ordered.push(extra);
    }
  }
  const finalModels = ordered.length > 0 ? ordered : FALLBACK_FLASH_CANDIDATES.filter((m) => (circuitState.unavailableModelsUntil.get(m) || 0) <= now);
  if (ordered.length > 0) {
    circuitState.verifiedFallbackModels = finalModels;
    circuitState.verifiedFallbackExpiresAt = now + FALLBACK_CACHE_TTL_MS;
  }
  return finalModels;
}
function buildInteractionParamsForModel(model, payload, includePreviousInteractionId, forceLowThinking = false, stream = false) {
  const usePrev = Boolean(includePreviousInteractionId && payload.previous_interaction_id);
  const params = {
    api_version: "v1beta",
    model,
    input: usePrev ? payload.input : payload.inputWithoutPreviousId ?? payload.input
  };
  if (stream) {
    params.stream = true;
  }
  if (payload.system_instruction) {
    params.system_instruction = payload.system_instruction;
  }
  if (usePrev) {
    params.previous_interaction_id = payload.previous_interaction_id;
  }
  if (payload.response_format) {
    params.response_format = payload.response_format;
  }
  if (payload.thinking_level && !model.includes("flash-lite")) {
    params.generation_config = {
      thinking_level: forceLowThinking ? "low" : payload.thinking_level
    };
  }
  return params;
}
async function invokeInteractionOnce(ai, model, payload, timeoutMs, allowPreviousId, forceLowThinking = false, signal) {
  const params = buildInteractionParamsForModel(model, payload, allowPreviousId, forceLowThinking, false);
  const reqOpts = {
    timeout_ms: timeoutMs,
    retries: { strategy: "none" }
  };
  if (signal) reqOpts.signal = signal;
  let interaction;
  try {
    interaction = await ai.interactions.create(params, reqOpts);
  } catch (err) {
    if (allowPreviousId && payload.previous_interaction_id && isPreviousInteractionError(err)) {
      const retryParams = buildInteractionParamsForModel(model, payload, false, forceLowThinking, false);
      interaction = await ai.interactions.create(retryParams, reqOpts);
    } else {
      throw err;
    }
  }
  const text = extractInteractionOutputText(interaction);
  if (!text) {
    const emptyErr = new Error("Model returned an empty response.");
    emptyErr.code = "EMPTY_RESPONSE";
    throw emptyErr;
  }
  return { text, interaction };
}
async function consumeStreamAttempt(ai, model, payload, opts) {
  const attemptController = new AbortController();
  const onParentAbort = () => attemptController.abort(opts.parentSignal?.reason);
  if (opts.parentSignal) {
    if (opts.parentSignal.aborted) {
      throw Object.assign(new Error("Request aborted by client"), { name: "AbortError" });
    }
    opts.parentSignal.addEventListener("abort", onParentAbort, { once: true });
  }
  let ttftTimer = null;
  let overallTimer = null;
  let timedOutReason = null;
  ttftTimer = setTimeout(() => {
    timedOutReason = "ttft";
    attemptController.abort(new Error("TimeoutError: First-token deadline exceeded"));
  }, opts.firstTokenTimeoutMs);
  overallTimer = setTimeout(() => {
    timedOutReason = "overall";
    attemptController.abort(new Error("TimeoutError: Overall stream deadline exceeded"));
  }, opts.overallTimeoutMs);
  let emittedAnyDelta = false;
  let firstTokenMs = 0;
  let interactionId = null;
  const chunks = [];
  try {
    const createStream = async (usePrevId) => {
      const params = buildInteractionParamsForModel(model, payload, usePrevId, opts.forceLowThinking, true);
      return await ai.interactions.create(params, {
        timeout_ms: opts.overallTimeoutMs,
        signal: attemptController.signal,
        retries: { strategy: "none" }
      });
    };
    let stream;
    try {
      stream = await createStream(opts.allowPreviousId);
    } catch (err) {
      if (opts.allowPreviousId && payload.previous_interaction_id && isPreviousInteractionError(err)) {
        stream = await createStream(false);
      } else {
        throw err;
      }
    }
    if (stream && typeof stream[Symbol.asyncIterator] !== "function") {
      const fallbackText = extractInteractionOutputText(stream);
      if (!fallbackText) {
        const emptyErr = new Error("Model returned an empty response.");
        emptyErr.code = "EMPTY_RESPONSE";
        throw emptyErr;
      }
      if (ttftTimer) clearTimeout(ttftTimer);
      firstTokenMs = Math.max(1, opts.nowFn() - opts.attemptStartTime);
      opts.onFirstToken(firstTokenMs);
      opts.onDelta(fallbackText);
      return {
        text: fallbackText,
        interactionId: stream?.id || null,
        ttftMs: firstTokenMs
      };
    }
    for await (const event of stream) {
      if (attemptController.signal.aborted) {
        break;
      }
      if (event?.event_type === "interaction.created" || event?.event_type === "interaction.completed") {
        if (event?.interaction?.id) {
          interactionId = String(event.interaction.id);
        }
      } else if (event?.event_type === "error") {
        const evErr = new Error(event?.error?.message || "Interaction stream error");
        evErr.status = event?.error?.code;
        evErr.data$ = { error: event?.error };
        throw evErr;
      } else if (event?.event_type === "step.delta" || event?.event_type === "content.delta") {
        const delta = event?.delta;
        if (delta?.type === "text" && typeof delta.text === "string" && delta.text.length > 0) {
          if (!emittedAnyDelta) {
            emittedAnyDelta = true;
            if (ttftTimer) {
              clearTimeout(ttftTimer);
              ttftTimer = null;
            }
            firstTokenMs = Math.max(1, opts.nowFn() - opts.attemptStartTime);
            opts.onFirstToken(firstTokenMs);
          }
          chunks.push(delta.text);
          opts.onDelta(delta.text);
        }
      }
    }
    if (timedOutReason) {
      const toErr = new Error(`Request timed out: TimeoutError (${timedOutReason})`);
      toErr.name = "APIConnectionTimeoutError";
      toErr.status = 504;
      throw toErr;
    }
    const fullText = chunks.join("");
    if (!fullText.trim()) {
      const emptyErr = new Error("Model returned an empty stream.");
      emptyErr.code = "EMPTY_RESPONSE";
      throw emptyErr;
    }
    return {
      text: fullText.trim(),
      interactionId,
      ttftMs: firstTokenMs || Math.max(1, opts.nowFn() - opts.attemptStartTime)
    };
  } catch (err) {
    if (timedOutReason && !emittedAnyDelta) {
      const toErr = new Error(`Request timed out: TimeoutError (${timedOutReason})`);
      toErr.name = "APIConnectionTimeoutError";
      toErr.status = 504;
      throw toErr;
    }
    if (emittedAnyDelta) {
      err.partialStreamEmitted = true;
    }
    throw err;
  } finally {
    if (ttftTimer) clearTimeout(ttftTimer);
    if (overallTimer) clearTimeout(overallTimer);
    if (opts.parentSignal) {
      opts.parentSignal.removeEventListener("abort", onParentAbort);
    }
  }
}
var GeminiResilienceError = class extends Error {
  constructor(message, opts) {
    super(message);
    this.name = "GeminiResilienceError";
    this.httpStatus = opts.httpStatus;
    this.errorCode = opts.errorCode;
    this.retryable = opts.retryable;
    this.primaryError = opts.meta.primaryError;
    this.fallbackError = opts.meta.fallbackError;
    this.meta = opts.meta;
  }
};
function mapCategoryToErrorCode(cat) {
  switch (cat) {
    case "high_demand":
      return "HIGH_DEMAND";
    case "rate_limit":
      return "RATE_LIMIT";
    case "timeout":
      return "TIMEOUT";
    case "auth_error":
      return "AUTH_ERROR";
    case "permission_denied":
      return "PERMISSION_DENIED";
    case "attachment_rejected":
      return "ATTACHMENT_REJECTED";
    case "bad_request":
      return "BAD_REQUEST";
    case "model_unavailable":
      return "MODEL_UNAVAILABLE";
    case "empty_response":
      return "EMPTY_RESPONSE";
    case "network_error":
      return "NETWORK_ERROR";
    case "server_error":
      return "SERVER_ERROR";
    default:
      return "INTERNAL_ERROR";
  }
}
async function executeGeminiInteractionWithResilience(payload, options) {
  const nowFn = options.nowFn || Date.now;
  const sleepFn = options.sleepFn || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxPrimaryRetries = options.maxPrimaryRetries ?? MAX_PRIMARY_RETRIES;
  const backoffSchedule = options.backoffScheduleMs ?? BACKOFF_SCHEDULE_MS;
  const jitterMaxMs = options.jitterMaxMs ?? 150;
  const log = options.onLog || ((entry) => console.log("[GeminiResilience]", JSON.stringify(entry)));
  const startTime = nowFn();
  let totalAttempts = 0;
  let primaryErrorInfo = null;
  let fallbackErrorInfo = null;
  let ai;
  try {
    ai = options.clientFactory ? options.clientFactory() : createGeminiClient();
  } catch (err) {
    const classified = classifyGeminiError(err);
    const meta2 = {
      model: PRIMARY_GEMINI_MODEL,
      usedFallback: false,
      attempts: 0,
      durationMs: nowFn() - startTime,
      primaryError: { category: classified.category, httpStatus: classified.httpStatus, summary: classified.rawSummary },
      fallbackError: null
    };
    log({ endpoint: options.endpoint, event: "client_init_error", ...meta2 });
    throw new GeminiResilienceError(classified.safeMessage, {
      httpStatus: classified.httpStatus,
      errorCode: mapCategoryToErrorCode(classified.category),
      retryable: false,
      meta: meta2
    });
  }
  const now = nowFn();
  const skipPrimaryBecauseCooldown = now < circuitState.primaryCooldownUntil;
  let shouldTriggerFallback = skipPrimaryBecauseCooldown;
  let forceLowThinking = false;
  if (!skipPrimaryBecauseCooldown) {
    for (let retryIdx = 0; retryIdx <= maxPrimaryRetries; retryIdx++) {
      totalAttempts += 1;
      try {
        const result = await invokeInteractionOnce(
          ai,
          PRIMARY_GEMINI_MODEL,
          payload,
          timeoutMs,
          Boolean(payload.previous_interaction_id),
          forceLowThinking,
          options.signal
        );
        circuitState.primaryCooldownUntil = 0;
        const meta2 = {
          model: PRIMARY_GEMINI_MODEL,
          usedFallback: false,
          attempts: totalAttempts,
          durationMs: nowFn() - startTime,
          primaryError: primaryErrorInfo,
          fallbackError: null
        };
        log({ endpoint: options.endpoint, event: "success", ...meta2 });
        return { ...result, meta: meta2 };
      } catch (err) {
        const classified = classifyGeminiError(err);
        primaryErrorInfo = {
          category: classified.category,
          httpStatus: classified.httpStatus,
          summary: classified.rawSummary
        };
        if (classified.category === "timeout") {
          forceLowThinking = true;
        }
        log({
          endpoint: options.endpoint,
          event: "primary_attempt_failed",
          model: PRIMARY_GEMINI_MODEL,
          attempt: totalAttempts,
          category: classified.category,
          httpStatus: classified.httpStatus,
          retryable: classified.retryableOnSameModel,
          summary: classified.rawSummary
        });
        if (!classified.retryableOnSameModel && !classified.triggersFallback) {
          const meta2 = {
            model: PRIMARY_GEMINI_MODEL,
            usedFallback: false,
            attempts: totalAttempts,
            durationMs: nowFn() - startTime,
            primaryError: primaryErrorInfo,
            fallbackError: null
          };
          throw new GeminiResilienceError(classified.safeMessage, {
            httpStatus: classified.httpStatus,
            errorCode: mapCategoryToErrorCode(classified.category),
            retryable: false,
            meta: meta2
          });
        }
        if (!classified.retryableOnSameModel && classified.triggersFallback) {
          shouldTriggerFallback = true;
          break;
        }
        if (retryIdx < maxPrimaryRetries) {
          const waitMs = computeBackoffDelayMs(retryIdx, backoffSchedule, jitterMaxMs);
          await sleepFn(waitMs);
        } else {
          circuitState.primaryCooldownUntil = nowFn() + PRIMARY_COOLDOWN_MS;
          shouldTriggerFallback = true;
        }
      }
    }
  } else {
    primaryErrorInfo = {
      category: "high_demand",
      httpStatus: 503,
      summary: "Primary model in circuit-breaker cooldown window after recent failure."
    };
  }
  if (shouldTriggerFallback) {
    const fallbackModels = await resolveVerifiedFallbackModels(ai, nowFn);
    for (const fallbackModel of fallbackModels) {
      totalAttempts += 1;
      try {
        const result = await invokeInteractionOnce(
          ai,
          fallbackModel,
          payload,
          timeoutMs,
          false,
          true,
          options.signal
        );
        const meta2 = {
          model: fallbackModel,
          usedFallback: true,
          attempts: totalAttempts,
          durationMs: nowFn() - startTime,
          primaryError: primaryErrorInfo,
          fallbackError: fallbackErrorInfo
        };
        log({ endpoint: options.endpoint, event: "fallback_success", ...meta2 });
        return { ...result, meta: meta2 };
      } catch (err) {
        const classified = classifyGeminiError(err);
        fallbackErrorInfo = {
          model: fallbackModel,
          category: classified.category,
          httpStatus: classified.httpStatus,
          summary: classified.rawSummary
        };
        log({
          endpoint: options.endpoint,
          event: "fallback_attempt_failed",
          model: fallbackModel,
          attempt: totalAttempts,
          category: classified.category,
          httpStatus: classified.httpStatus,
          summary: classified.rawSummary
        });
        if (classified.category === "auth_error" || classified.category === "permission_denied" || classified.category === "attachment_rejected" || classified.category === "bad_request") {
          const meta2 = {
            model: fallbackModel,
            usedFallback: true,
            attempts: totalAttempts,
            durationMs: nowFn() - startTime,
            primaryError: primaryErrorInfo,
            fallbackError: fallbackErrorInfo
          };
          throw new GeminiResilienceError(classified.safeMessage, {
            httpStatus: classified.httpStatus,
            errorCode: mapCategoryToErrorCode(classified.category),
            retryable: false,
            meta: meta2
          });
        }
        if (classified.category === "model_unavailable") {
          circuitState.unavailableModelsUntil.set(fallbackModel, nowFn() + FALLBACK_CACHE_TTL_MS);
        }
      }
    }
  }
  const lastCat = fallbackErrorInfo?.category || primaryErrorInfo?.category || "high_demand";
  const lastStatus = fallbackErrorInfo?.httpStatus || primaryErrorInfo?.httpStatus || 503;
  const meta = {
    model: fallbackErrorInfo?.model || PRIMARY_GEMINI_MODEL,
    usedFallback: Boolean(fallbackErrorInfo),
    attempts: totalAttempts,
    durationMs: nowFn() - startTime,
    primaryError: primaryErrorInfo,
    fallbackError: fallbackErrorInfo
  };
  log({ endpoint: options.endpoint, event: "all_models_failed", ...meta });
  const safeMsg = lastCat === "rate_limit" ? "\u0627\u0644\u0645\u062F\u0631\u0633 \u0627\u0644\u0630\u0643\u064A \u064A\u0648\u0627\u062C\u0647 \u0636\u063A\u0637\u064B\u0627 \u0645\u0624\u0642\u062A\u064B\u0627 \u0641\u064A \u0627\u0644\u0637\u0644\u0628\u0627\u062A. \u064A\u0631\u062C\u0649 \u0625\u0639\u0627\u062F\u0629 \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629 \u0628\u0639\u062F \u0644\u062D\u0638\u0627\u062A." : lastCat === "timeout" ? "\u0627\u0633\u062A\u063A\u0631\u0642 \u0627\u0644\u0627\u062A\u0635\u0627\u0644 \u0648\u0642\u062A\u064B\u0627 \u0623\u0637\u0648\u0644 \u0645\u0646 \u0627\u0644\u0645\u0639\u062A\u0627\u062F. \u0633\u0624\u0627\u0644\u0643 \u0645\u062D\u0641\u0648\u0638\u060C \u064A\u0631\u062C\u0649 \u0627\u0644\u0636\u063A\u0637 \u0639\u0644\u0649 \u0625\u0639\u0627\u062F\u0629 \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629." : lastCat === "network_error" ? "\u062A\u0639\u0630\u0631 \u0627\u0644\u0627\u062A\u0635\u0627\u0644 \u0628\u0627\u0644\u062E\u062F\u0645\u0629 \u0645\u0624\u0642\u062A\u064B\u0627. \u064A\u0631\u062C\u0649 \u0627\u0644\u062A\u0623\u0643\u062F \u0645\u0646 \u0627\u062A\u0635\u0627\u0644 \u0627\u0644\u0625\u0646\u062A\u0631\u0646\u062A \u0648\u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629 \u0645\u0631\u0629 \u0623\u062E\u0631\u0649." : "\u0627\u0644\u0645\u062F\u0631\u0633 \u0627\u0644\u0630\u0643\u064A \u0645\u0634\u063A\u0648\u0644 \u062D\u0627\u0644\u064A\u064B\u0627 \u0628\u0637\u0644\u0628\u0627\u062A \u0643\u062B\u064A\u0631\u0629. \u0633\u0624\u0627\u0644\u0643 \u0645\u062D\u0641\u0648\u0638\u060C \u064A\u0631\u062C\u0649 \u0625\u0639\u0627\u062F\u0629 \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629 \u0628\u0639\u062F \u0644\u062D\u0638\u0627\u062A.";
  throw new GeminiResilienceError(safeMsg, {
    httpStatus: lastStatus,
    errorCode: mapCategoryToErrorCode(lastCat),
    retryable: true,
    meta
  });
}
async function executeGeminiInteractionStreamWithResilience(payload, callbacks, options) {
  const nowFn = options.nowFn || Date.now;
  const sleepFn = options.sleepFn || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const firstTokenTimeoutMs = options.firstTokenTimeoutMs ?? DEFAULT_FIRST_TOKEN_TIMEOUT_MS;
  const overallTimeoutMs = options.timeoutMs ?? Math.max(DEFAULT_TIMEOUT_MS, 35e3);
  const maxPrimaryRetries = options.maxPrimaryRetries ?? MAX_PRIMARY_RETRIES;
  const backoffSchedule = options.backoffScheduleMs ?? BACKOFF_SCHEDULE_MS;
  const jitterMaxMs = options.jitterMaxMs ?? 150;
  const log = options.onLog || ((entry) => console.log("[GeminiResilience]", JSON.stringify(entry)));
  const startTime = nowFn();
  let totalAttempts = 0;
  let primaryErrorInfo = null;
  let fallbackErrorInfo = null;
  let ai;
  try {
    ai = options.clientFactory ? options.clientFactory() : createGeminiClient();
  } catch (err) {
    const classified = classifyGeminiError(err);
    const meta2 = {
      model: PRIMARY_GEMINI_MODEL,
      usedFallback: false,
      attempts: 0,
      durationMs: nowFn() - startTime,
      primaryError: { category: classified.category, httpStatus: classified.httpStatus, summary: classified.rawSummary },
      fallbackError: null
    };
    log({ endpoint: options.endpoint, event: "client_init_error", ...meta2 });
    throw new GeminiResilienceError(classified.safeMessage, {
      httpStatus: classified.httpStatus,
      errorCode: mapCategoryToErrorCode(classified.category),
      retryable: false,
      meta: meta2
    });
  }
  const now = nowFn();
  const skipPrimaryBecauseCooldown = now < circuitState.primaryCooldownUntil;
  let shouldTriggerFallback = skipPrimaryBecauseCooldown;
  let forceLowThinking = false;
  if (!skipPrimaryBecauseCooldown) {
    for (let retryIdx = 0; retryIdx <= maxPrimaryRetries; retryIdx++) {
      totalAttempts += 1;
      try {
        const res = await consumeStreamAttempt(ai, PRIMARY_GEMINI_MODEL, payload, {
          firstTokenTimeoutMs,
          overallTimeoutMs,
          allowPreviousId: Boolean(payload.previous_interaction_id),
          forceLowThinking,
          parentSignal: options.signal,
          nowFn,
          attemptStartTime: startTime,
          onDelta: callbacks.onDelta,
          onFirstToken: (ttftMs) => callbacks.onFirstToken?.({
            model: PRIMARY_GEMINI_MODEL,
            usedFallback: false,
            ttftMs,
            attempts: totalAttempts
          })
        });
        circuitState.primaryCooldownUntil = 0;
        const meta2 = {
          model: PRIMARY_GEMINI_MODEL,
          usedFallback: false,
          attempts: totalAttempts,
          durationMs: nowFn() - startTime,
          ttftMs: res.ttftMs,
          primaryError: primaryErrorInfo,
          fallbackError: null
        };
        log({ endpoint: options.endpoint, event: "stream_success", ...meta2 });
        return { text: res.text, interactionId: res.interactionId, meta: meta2 };
      } catch (err) {
        if (err?.partialStreamEmitted || options.signal?.aborted) {
          const classified2 = classifyGeminiError(err);
          const meta2 = {
            model: PRIMARY_GEMINI_MODEL,
            usedFallback: false,
            attempts: totalAttempts,
            durationMs: nowFn() - startTime,
            primaryError: primaryErrorInfo,
            fallbackError: null
          };
          throw new GeminiResilienceError(classified2.safeMessage, {
            httpStatus: classified2.httpStatus,
            errorCode: mapCategoryToErrorCode(classified2.category),
            retryable: true,
            meta: meta2
          });
        }
        const classified = classifyGeminiError(err);
        primaryErrorInfo = {
          category: classified.category,
          httpStatus: classified.httpStatus,
          summary: classified.rawSummary
        };
        if (classified.category === "timeout") {
          forceLowThinking = true;
        }
        log({
          endpoint: options.endpoint,
          event: "primary_stream_failed",
          model: PRIMARY_GEMINI_MODEL,
          attempt: totalAttempts,
          category: classified.category,
          httpStatus: classified.httpStatus,
          retryable: classified.retryableOnSameModel,
          summary: classified.rawSummary
        });
        if (!classified.retryableOnSameModel && !classified.triggersFallback) {
          const meta2 = {
            model: PRIMARY_GEMINI_MODEL,
            usedFallback: false,
            attempts: totalAttempts,
            durationMs: nowFn() - startTime,
            primaryError: primaryErrorInfo,
            fallbackError: null
          };
          throw new GeminiResilienceError(classified.safeMessage, {
            httpStatus: classified.httpStatus,
            errorCode: mapCategoryToErrorCode(classified.category),
            retryable: false,
            meta: meta2
          });
        }
        if (!classified.retryableOnSameModel && classified.triggersFallback) {
          shouldTriggerFallback = true;
          break;
        }
        if (retryIdx < maxPrimaryRetries) {
          const waitMs = computeBackoffDelayMs(retryIdx, backoffSchedule, jitterMaxMs);
          await sleepFn(waitMs);
        } else {
          circuitState.primaryCooldownUntil = nowFn() + PRIMARY_COOLDOWN_MS;
          shouldTriggerFallback = true;
        }
      }
    }
  } else {
    primaryErrorInfo = {
      category: "high_demand",
      httpStatus: 503,
      summary: "Primary model in circuit-breaker cooldown window after recent failure."
    };
  }
  if (shouldTriggerFallback) {
    const fallbackModels = await resolveVerifiedFallbackModels(ai, nowFn);
    for (const fallbackModel of fallbackModels) {
      totalAttempts += 1;
      try {
        const res = await consumeStreamAttempt(ai, fallbackModel, payload, {
          firstTokenTimeoutMs,
          overallTimeoutMs,
          allowPreviousId: false,
          forceLowThinking: true,
          parentSignal: options.signal,
          nowFn,
          attemptStartTime: startTime,
          onDelta: callbacks.onDelta,
          onFirstToken: (ttftMs) => callbacks.onFirstToken?.({
            model: fallbackModel,
            usedFallback: true,
            ttftMs,
            attempts: totalAttempts
          })
        });
        const meta2 = {
          model: fallbackModel,
          usedFallback: true,
          attempts: totalAttempts,
          durationMs: nowFn() - startTime,
          ttftMs: res.ttftMs,
          primaryError: primaryErrorInfo,
          fallbackError: fallbackErrorInfo
        };
        log({ endpoint: options.endpoint, event: "fallback_stream_success", ...meta2 });
        return { text: res.text, interactionId: res.interactionId, meta: meta2 };
      } catch (err) {
        if (err?.partialStreamEmitted || options.signal?.aborted) {
          const classified2 = classifyGeminiError(err);
          const meta2 = {
            model: fallbackModel,
            usedFallback: true,
            attempts: totalAttempts,
            durationMs: nowFn() - startTime,
            primaryError: primaryErrorInfo,
            fallbackError: fallbackErrorInfo
          };
          throw new GeminiResilienceError(classified2.safeMessage, {
            httpStatus: classified2.httpStatus,
            errorCode: mapCategoryToErrorCode(classified2.category),
            retryable: true,
            meta: meta2
          });
        }
        const classified = classifyGeminiError(err);
        fallbackErrorInfo = {
          model: fallbackModel,
          category: classified.category,
          httpStatus: classified.httpStatus,
          summary: classified.rawSummary
        };
        log({
          endpoint: options.endpoint,
          event: "fallback_stream_failed",
          model: fallbackModel,
          attempt: totalAttempts,
          category: classified.category,
          httpStatus: classified.httpStatus,
          summary: classified.rawSummary
        });
        if (classified.category === "auth_error" || classified.category === "permission_denied" || classified.category === "attachment_rejected" || classified.category === "bad_request") {
          const meta2 = {
            model: fallbackModel,
            usedFallback: true,
            attempts: totalAttempts,
            durationMs: nowFn() - startTime,
            primaryError: primaryErrorInfo,
            fallbackError: fallbackErrorInfo
          };
          throw new GeminiResilienceError(classified.safeMessage, {
            httpStatus: classified.httpStatus,
            errorCode: mapCategoryToErrorCode(classified.category),
            retryable: false,
            meta: meta2
          });
        }
        if (classified.category === "model_unavailable") {
          circuitState.unavailableModelsUntil.set(fallbackModel, nowFn() + FALLBACK_CACHE_TTL_MS);
        }
      }
    }
  }
  const lastCat = fallbackErrorInfo?.category || primaryErrorInfo?.category || "high_demand";
  const lastStatus = fallbackErrorInfo?.httpStatus || primaryErrorInfo?.httpStatus || 503;
  const meta = {
    model: fallbackErrorInfo?.model || PRIMARY_GEMINI_MODEL,
    usedFallback: Boolean(fallbackErrorInfo),
    attempts: totalAttempts,
    durationMs: nowFn() - startTime,
    primaryError: primaryErrorInfo,
    fallbackError: fallbackErrorInfo
  };
  log({ endpoint: options.endpoint, event: "all_models_stream_failed", ...meta });
  const safeMsg = lastCat === "rate_limit" ? "\u0627\u0644\u0645\u062F\u0631\u0633 \u0627\u0644\u0630\u0643\u064A \u064A\u0648\u0627\u062C\u0647 \u0636\u063A\u0637\u064B\u0627 \u0645\u0624\u0642\u062A\u064B\u0627 \u0641\u064A \u0627\u0644\u0637\u0644\u0628\u0627\u062A. \u064A\u0631\u062C\u0649 \u0625\u0639\u0627\u062F\u0629 \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629 \u0628\u0639\u062F \u0644\u062D\u0638\u0627\u062A." : lastCat === "timeout" ? "\u0627\u0633\u062A\u063A\u0631\u0642 \u0627\u0644\u0627\u062A\u0635\u0627\u0644 \u0648\u0642\u062A\u064B\u0627 \u0623\u0637\u0648\u0644 \u0645\u0646 \u0627\u0644\u0645\u0639\u062A\u0627\u062F. \u0633\u0624\u0627\u0644\u0643 \u0645\u062D\u0641\u0648\u0638\u060C \u064A\u0631\u062C\u0649 \u0627\u0644\u0636\u063A\u0637 \u0639\u0644\u0649 \u0625\u0639\u0627\u062F\u0629 \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629." : lastCat === "network_error" ? "\u062A\u0639\u0630\u0631 \u0627\u0644\u0627\u062A\u0635\u0627\u0644 \u0628\u0627\u0644\u062E\u062F\u0645\u0629 \u0645\u0624\u0642\u062A\u064B\u0627. \u064A\u0631\u062C\u0649 \u0627\u0644\u062A\u0623\u0643\u062F \u0645\u0646 \u0627\u062A\u0635\u0627\u0644 \u0627\u0644\u0625\u0646\u062A\u0631\u0646\u062A \u0648\u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629 \u0645\u0631\u0629 \u0623\u062E\u0631\u0649." : "\u0627\u0644\u0645\u062F\u0631\u0633 \u0627\u0644\u0630\u0643\u064A \u0645\u0634\u063A\u0648\u0644 \u062D\u0627\u0644\u064A\u064B\u0627 \u0628\u0637\u0644\u0628\u0627\u062A \u0643\u062B\u064A\u0631\u0629. \u0633\u0624\u0627\u0644\u0643 \u0645\u062D\u0641\u0648\u0638\u060C \u064A\u0631\u062C\u0649 \u0625\u0639\u0627\u062F\u0629 \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629 \u0628\u0639\u062F \u0644\u062D\u0638\u0627\u062A.";
  throw new GeminiResilienceError(safeMsg, {
    httpStatus: lastStatus,
    errorCode: mapCategoryToErrorCode(lastCat),
    retryable: true,
    meta
  });
}
async function verifyGeminiAuthAndConnectivity(clientFactory) {
  const start = Date.now();
  const { apiKey } = getConfiguredGeminiKey();
  if (!apiKey && !clientFactory) {
    return {
      ok: false,
      keyPresent: false,
      authenticated: false,
      modelAvailable: false,
      responseValid: false,
      httpStatus: 401,
      errorCode: "API_KEY_MISSING",
      model: PRIMARY_GEMINI_MODEL,
      durationMs: Date.now() - start,
      guidance: "\u0627\u0644\u0645\u062A\u063A\u064A\u0631 GEMINI_API_KEY \u063A\u064A\u0631 \u0645\u0636\u0627\u0641 \u0623\u0648 \u0641\u0627\u0631\u063A \u0641\u064A \u0628\u064A\u0626\u0629 \u0627\u0644\u0625\u0646\u062A\u0627\u062C \u0639\u0644\u0649 Vercel. \u0623\u0636\u0641\u0647 \u0641\u064A Environment Variables \u0644\u0628\u064A\u0626\u0629 Production \u062B\u0645 \u0646\u0641\u0651\u0630 Redeploy.",
      diagnosticSummary: "GEMINI_API_KEY is not configured in server environment."
    };
  }
  let ai;
  try {
    ai = clientFactory ? clientFactory() : createGeminiClient();
  } catch (err) {
    const classified = classifyGeminiError(err);
    return {
      ok: false,
      keyPresent: Boolean(apiKey),
      authenticated: false,
      modelAvailable: false,
      responseValid: false,
      httpStatus: classified.httpStatus,
      errorCode: mapCategoryToErrorCode(classified.category),
      model: PRIMARY_GEMINI_MODEL,
      durationMs: Date.now() - start,
      guidance: classified.safeMessage,
      diagnosticSummary: classified.rawSummary
    };
  }
  try {
    const interaction = await ai.interactions.create(
      {
        model: PRIMARY_GEMINI_MODEL,
        input: "Reply strictly with: OK",
        generation_config: { thinking_level: "low" }
      },
      { timeout_ms: 12e3, retries: { strategy: "none" } }
    );
    const text = extractInteractionOutputText(interaction);
    const valid = Boolean(text && text.trim().length > 0);
    return {
      ok: valid,
      keyPresent: true,
      authenticated: true,
      modelAvailable: true,
      responseValid: valid,
      httpStatus: valid ? 200 : 502,
      errorCode: valid ? null : "EMPTY_RESPONSE",
      model: PRIMARY_GEMINI_MODEL,
      durationMs: Date.now() - start,
      guidance: valid ? "\u062A\u0645 \u0627\u0644\u062A\u062D\u0642\u0642 \u0645\u0646 \u0627\u0644\u0645\u0641\u062A\u0627\u062D \u0648\u0627\u0644\u0645\u0635\u0627\u062F\u0642\u0629 \u0648\u0627\u0633\u062A\u062F\u0639\u0627\u0621 Gemini \u0628\u0646\u062C\u0627\u062D." : "\u062A\u0645\u062A \u0627\u0644\u0645\u0635\u0627\u062F\u0642\u0629 \u0648\u0644\u0643\u0646 \u0639\u0627\u062F \u0627\u0644\u0646\u0645\u0648\u0630\u062C \u0628\u0631\u062F \u0641\u0627\u0631\u063A.",
      diagnosticSummary: null
    };
  } catch (err) {
    const classified = classifyGeminiError(err);
    const isAuthFailure = classified.category === "auth_error";
    const isPermDenied = classified.category === "permission_denied";
    const isModel404 = classified.category === "model_unavailable";
    const guidance = isAuthFailure ? "\u0627\u0644\u0645\u0641\u062A\u0627\u062D \u0645\u0631\u0641\u0648\u0636 \u0623\u0648 \u063A\u064A\u0631 \u0635\u0627\u0644\u062D (401). \u0623\u0646\u0634\u0626 \u0645\u0641\u062A\u0627\u062D GEMINI_API_KEY \u062C\u062F\u064A\u062F\u064B\u0627 \u0645\u0646 Google AI Studio \u0648\u0627\u0631\u0628\u0637\u0647 \u0628\u0627\u0644\u0645\u0634\u0631\u0648\u0639 \u0627\u0644\u0635\u062D\u064A\u062D \u062B\u0645 \u062D\u062F\u0651\u062B\u0647 \u0641\u064A Vercel." : isPermDenied ? "\u0627\u0644\u0645\u0641\u062A\u0627\u062D \u0645\u0648\u062C\u0648\u062F \u0644\u0643\u0646\u0647 \u0645\u0642\u064A\u0651\u062F \u0623\u0648 \u064A\u0641\u062A\u0642\u0631 \u0644\u0644\u0635\u0644\u0627\u062D\u064A\u0627\u062A (403). \u062A\u0623\u0643\u062F \u0641\u064A Google AI Studio / Cloud Console \u0645\u0646 \u062A\u0641\u0639\u064A\u0644 Generative Language API \u0648\u0639\u062F\u0645 \u0648\u062C\u0648\u062F \u0642\u064A\u0648\u062F HTTP Referrer \u062A\u0645\u0646\u0639 \u062E\u0648\u0627\u062F\u0645 Vercel." : isModel404 ? `\u0627\u0644\u0646\u0645\u0648\u0630\u062C (${PRIMARY_GEMINI_MODEL}) \u063A\u064A\u0631 \u0645\u062A\u0627\u062D \u0644\u0647\u0630\u0627 \u0627\u0644\u0645\u0634\u0631\u0648\u0639 \u0623\u0648 \u0645\u0633\u0627\u0631 API \u063A\u064A\u0631 \u0645\u062F\u0639\u0648\u0645 (404).` : classified.category === "rate_limit" ? "\u062A\u0645 \u062A\u062C\u0627\u0648\u0632 \u062D\u062F \u0627\u0644\u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u0627\u0644\u0645\u0633\u0645\u0648\u062D \u0644\u0644\u0645\u0641\u062A\u0627\u062D \u062D\u0627\u0644\u064A\u064B\u0627 (429)." : classified.category === "high_demand" ? "\u0636\u063A\u0637 \u0645\u0624\u0642\u062A \u0639\u0644\u0649 \u062E\u0648\u0627\u062F\u0645 Google Gemini (503) \u2014 \u0627\u0644\u0645\u0635\u0627\u062F\u0642\u0629 \u0646\u0641\u0633\u0647\u0627 \u0635\u0627\u0644\u062D\u0629." : classified.safeMessage;
    return {
      ok: false,
      keyPresent: true,
      authenticated: !isAuthFailure && !isPermDenied,
      modelAvailable: !isModel404 && !isAuthFailure && !isPermDenied,
      responseValid: false,
      httpStatus: classified.httpStatus,
      errorCode: mapCategoryToErrorCode(classified.category),
      model: PRIMARY_GEMINI_MODEL,
      durationMs: Date.now() - start,
      guidance,
      diagnosticSummary: sanitizeSecret(classified.rawSummary).slice(0, 260)
    };
  }
}

// server/attachmentHandler.ts
var ALLOWED_IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp"];
var ALLOWED_PDF_MIME = "application/pdf";
var MAX_INLINE_RAW_BYTES = 3 * 1024 * 1024;
var MAX_BINARY_UPLOAD_BYTES = Math.floor(4.2 * 1024 * 1024);
var MAX_PDF_PAGES = 50;
var AttachmentValidationError = class extends Error {
  constructor(message, opts) {
    super(message);
    this.name = "AttachmentValidationError";
    this.status = opts.status;
    this.errorCode = opts.errorCode;
    this.stage = opts.stage;
    this.retryable = opts.retryable ?? false;
  }
};
function logAttachmentStage(info) {
  console.log(
    "[AttachmentPipeline]",
    JSON.stringify({
      stage: info.stage,
      fn: info.fn,
      fileKind: info.fileKind,
      mimeType: info.mimeType || "unknown",
      sizeBytes: info.sizeBytes,
      pageCount: info.pageCount ?? null,
      transport: info.transport ?? null,
      httpStatus: info.httpStatus ?? null,
      errorCode: info.errorCode ?? null,
      summary: info.summary ? sanitizeSecret(info.summary).slice(0, 220) : null
    })
  );
}
function normalizeDeclaredMime(rawMime) {
  const cleaned = String(rawMime || "").toLowerCase().split(";")[0].trim();
  if (cleaned === "image/jpg" || cleaned === "image/pjpeg") return "image/jpeg";
  return cleaned;
}
function detectMagicMimeType(buffer) {
  if (!buffer || buffer.length < 4) return null;
  if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) {
    return "image/jpeg";
  }
  if (buffer.length >= 8 && buffer[0] === 137 && buffer[1] === 80 && buffer[2] === 78 && buffer[3] === 71 && buffer[4] === 13 && buffer[5] === 10 && buffer[6] === 26 && buffer[7] === 10) {
    return "image/png";
  }
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  const head = buffer.subarray(0, Math.min(buffer.length, 1024)).toString("latin1");
  if (head.includes("%PDF-")) {
    return "application/pdf";
  }
  return null;
}
function inspectPdfBuffer(buffer) {
  const head = buffer.subarray(0, Math.min(buffer.length, 1024)).toString("latin1");
  if (!head.includes("%PDF-")) {
    return { validHeader: false, encrypted: false, pageCount: 0 };
  }
  const content = buffer.toString("latin1");
  const encrypted = /\/Encrypt\b/.test(content);
  const pageMatches = content.match(/\/Type\s*\/Page\b(?!s)/g);
  const pageCount = pageMatches && pageMatches.length > 0 ? pageMatches.length : 1;
  return { validHeader: true, encrypted, pageCount };
}
function isValidGeminiFileUri(uri) {
  try {
    const parsed = new URL(uri);
    return parsed.protocol === "https:" && parsed.hostname === "generativelanguage.googleapis.com" && parsed.pathname.includes("/files/");
  } catch {
    return false;
  }
}
function validateBinaryBufferAttachment(buffer, opts = {}) {
  const fn = opts.fn || "validateBinaryBufferAttachment";
  const maxBytes = opts.maxBytes ?? MAX_BINARY_UPLOAD_BYTES;
  const declared = normalizeDeclaredMime(opts.declaredMime);
  const name = String(opts.name || "attachment").slice(0, 120);
  if (!buffer || buffer.length === 0) {
    logAttachmentStage({
      stage: "backend_validate",
      fn,
      fileKind: declared === "application/pdf" ? "document" : "image",
      mimeType: declared,
      sizeBytes: 0,
      httpStatus: 400,
      errorCode: "EMPTY_FILE",
      summary: "Uploaded buffer is empty (0 bytes)."
    });
    throw new AttachmentValidationError("\u0627\u0644\u0645\u0644\u0641 \u0627\u0644\u0645\u0631\u0641\u0642 \u0641\u0627\u0631\u063A (0 \u0628\u0627\u064A\u062A). \u064A\u0631\u062C\u0649 \u0627\u062E\u062A\u064A\u0627\u0631 \u0645\u0644\u0641 \u0635\u0627\u0644\u062D.", {
      status: 400,
      errorCode: "EMPTY_FILE",
      stage: "backend_validate"
    });
  }
  if (buffer.length > maxBytes) {
    const limitMb = (maxBytes / (1024 * 1024)).toFixed(1);
    logAttachmentStage({
      stage: "backend_validate",
      fn,
      fileKind: declared === "application/pdf" ? "document" : "image",
      mimeType: declared,
      sizeBytes: buffer.length,
      httpStatus: 413,
      errorCode: "FILE_TOO_LARGE",
      summary: `Buffer ${buffer.length} bytes exceeds max ${maxBytes} bytes.`
    });
    throw new AttachmentValidationError(
      `\u062D\u062C\u0645 \u0627\u0644\u0645\u0644\u0641 (${(buffer.length / (1024 * 1024)).toFixed(2)} \u0645\u064A\u062C\u0627\u0628\u0627\u064A\u062A) \u064A\u062A\u062C\u0627\u0648\u0632 \u0627\u0644\u062D\u062F \u0627\u0644\u0645\u0633\u0645\u0648\u062D (${limitMb} \u0645\u064A\u062C\u0627\u0628\u0627\u064A\u062A).`,
      {
        status: 413,
        errorCode: "FILE_TOO_LARGE",
        stage: "backend_validate"
      }
    );
  }
  const detectedMime = detectMagicMimeType(buffer);
  if (!detectedMime) {
    const isAllowedDeclared = declared === ALLOWED_PDF_MIME || ALLOWED_IMAGE_MIMES.includes(declared);
    const errorCode = isAllowedDeclared ? "CORRUPTED_FILE" : "UNSUPPORTED_FILE_TYPE";
    const message = isAllowedDeclared ? "\u0627\u0644\u0645\u0644\u0641 \u062A\u0627\u0644\u0641 \u0623\u0648 \u0644\u0627 \u064A\u0637\u0627\u0628\u0642 \u0635\u064A\u063A\u0629 \u0627\u0644\u0635\u0648\u0631/PDF \u0627\u0644\u0642\u064A\u0627\u0633\u064A\u0629. \u064A\u0631\u062C\u0649 \u0627\u0644\u062A\u0623\u0643\u062F \u0645\u0646 \u0633\u0644\u0627\u0645\u0629 \u0627\u0644\u0645\u0644\u0641 \u0648\u0625\u0639\u0627\u062F\u0629 \u0627\u062E\u062A\u064A\u0627\u0631\u0647." : "\u0646\u0648\u0639 \u0627\u0644\u0645\u0644\u0641 \u063A\u064A\u0631 \u0645\u062F\u0639\u0648\u0645. \u0627\u0644\u0635\u064A\u063A \u0627\u0644\u0645\u062F\u0639\u0648\u0645\u0629 \u0641\u0642\u0637 \u0647\u064A: JPG \u0648JPEG \u0648PNG \u0648WEBP \u0648PDF.";
    logAttachmentStage({
      stage: "backend_validate",
      fn,
      fileKind: declared === "application/pdf" ? "document" : "unknown",
      mimeType: declared || "unknown",
      sizeBytes: buffer.length,
      httpStatus: 400,
      errorCode,
      summary: "Magic bytes did not match JPG, PNG, WEBP, or PDF."
    });
    throw new AttachmentValidationError(message, {
      status: 400,
      errorCode,
      stage: "backend_validate"
    });
  }
  const finalMime = detectedMime;
  if (finalMime === "application/pdf") {
    const pdfInfo = inspectPdfBuffer(buffer);
    if (!pdfInfo.validHeader) {
      throw new AttachmentValidationError("\u0645\u0644\u0641 PDF \u062A\u0627\u0644\u0641 \u0623\u0648 \u063A\u064A\u0631 \u0635\u0627\u0644\u062D.", {
        status: 400,
        errorCode: "CORRUPTED_FILE",
        stage: "backend_validate_pdf"
      });
    }
    if (pdfInfo.encrypted) {
      logAttachmentStage({
        stage: "backend_validate_pdf",
        fn,
        fileKind: "document",
        mimeType: finalMime,
        sizeBytes: buffer.length,
        httpStatus: 422,
        errorCode: "PDF_ENCRYPTED",
        summary: "PDF contains /Encrypt dictionary (password protected)."
      });
      throw new AttachmentValidationError(
        "\u0645\u0644\u0641 \u0627\u0644\u0640 PDF \u0645\u062D\u0645\u064A \u0628\u0643\u0644\u0645\u0629 \u0645\u0631\u0648\u0631 \u0623\u0648 \u0645\u0634\u0641\u0651\u0631 \u0648\u0644\u0627 \u064A\u0645\u0643\u0646 \u0642\u0631\u0627\u0621\u062A\u0647. \u064A\u0631\u062C\u0649 \u0625\u0632\u0627\u0644\u0629 \u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631 \u062B\u0645 \u0625\u0639\u0627\u062F\u0629 \u0631\u0641\u0639\u0647.",
        {
          status: 422,
          errorCode: "PDF_ENCRYPTED",
          stage: "backend_validate_pdf"
        }
      );
    }
    if (pdfInfo.pageCount > MAX_PDF_PAGES) {
      logAttachmentStage({
        stage: "backend_validate_pdf",
        fn,
        fileKind: "document",
        mimeType: finalMime,
        sizeBytes: buffer.length,
        pageCount: pdfInfo.pageCount,
        httpStatus: 413,
        errorCode: "PDF_TOO_MANY_PAGES",
        summary: `PDF page count ${pdfInfo.pageCount} exceeds limit ${MAX_PDF_PAGES}.`
      });
      throw new AttachmentValidationError(
        `\u0639\u062F\u062F \u0635\u0641\u062D\u0627\u062A \u0645\u0644\u0641 PDF (${pdfInfo.pageCount} \u0635\u0641\u062D\u0629) \u064A\u062A\u062C\u0627\u0648\u0632 \u0627\u0644\u062D\u062F \u0627\u0644\u0623\u0642\u0635\u0649 \u0627\u0644\u0645\u0633\u0645\u0648\u062D (${MAX_PDF_PAGES} \u0635\u0641\u062D\u0629).`,
        {
          status: 413,
          errorCode: "PDF_TOO_MANY_PAGES",
          stage: "backend_validate_pdf"
        }
      );
    }
    return {
      kind: "document",
      mimeType: "application/pdf",
      name,
      sizeBytes: buffer.length,
      pageCount: pdfInfo.pageCount,
      buffer
    };
  }
  return {
    kind: "image",
    mimeType: finalMime,
    name,
    sizeBytes: buffer.length,
    buffer
  };
}
function validateAndDecodeAttachment(attachment) {
  if (!attachment) return null;
  const declared = normalizeDeclaredMime(attachment.mimeType);
  const name = String(attachment.name || "attachment").slice(0, 120);
  if (typeof attachment.uri === "string" && attachment.uri.trim().length > 0) {
    const uri = attachment.uri.trim();
    if (!isValidGeminiFileUri(uri)) {
      logAttachmentStage({
        stage: "backend_validate_uri",
        fn: "validateAndDecodeAttachment",
        fileKind: declared === "application/pdf" ? "document" : "image",
        mimeType: declared,
        sizeBytes: attachment.sizeBytes || 0,
        httpStatus: 400,
        errorCode: "INVALID_FILE_URI",
        summary: "Attachment URI host/path validation failed."
      });
      throw new AttachmentValidationError("\u0645\u0631\u062C\u0639 \u0627\u0644\u0645\u0644\u0641 \u063A\u064A\u0631 \u0635\u0627\u0644\u062D. \u064A\u0631\u062C\u0649 \u0625\u0639\u0627\u062F\u0629 \u0631\u0641\u0639 \u0627\u0644\u0645\u0644\u0641.", {
        status: 400,
        errorCode: "INVALID_FILE_URI",
        stage: "backend_validate_uri"
      });
    }
    if (declared !== ALLOWED_PDF_MIME && !ALLOWED_IMAGE_MIMES.includes(declared)) {
      throw new AttachmentValidationError(
        "\u0646\u0648\u0639 \u0627\u0644\u0645\u0644\u0641 \u063A\u064A\u0631 \u0645\u062F\u0639\u0648\u0645. \u0627\u0644\u0635\u064A\u063A \u0627\u0644\u0645\u062F\u0639\u0648\u0645\u0629 \u0641\u0642\u0637 \u0647\u064A: JPG \u0648JPEG \u0648PNG \u0648WEBP \u0648PDF.",
        {
          status: 400,
          errorCode: "UNSUPPORTED_FILE_TYPE",
          stage: "backend_validate_uri"
        }
      );
    }
    const kind = declared === ALLOWED_PDF_MIME ? "document" : "image";
    logAttachmentStage({
      stage: "backend_validated",
      fn: "validateAndDecodeAttachment",
      fileKind: kind,
      mimeType: declared,
      sizeBytes: attachment.sizeBytes || 0,
      pageCount: attachment.pageCount,
      transport: "files_api_uri"
    });
    return {
      kind,
      mimeType: declared,
      name,
      sizeBytes: attachment.sizeBytes || 0,
      pageCount: attachment.pageCount,
      uri,
      fileName: attachment.fileName
    };
  }
  if (typeof attachment.data !== "string" || attachment.data.trim().length === 0) {
    logAttachmentStage({
      stage: "backend_validate_base64",
      fn: "validateAndDecodeAttachment",
      fileKind: declared === "application/pdf" ? "document" : "image",
      mimeType: declared,
      sizeBytes: 0,
      httpStatus: 400,
      errorCode: "EMPTY_FILE",
      summary: "Attachment missing both data and uri."
    });
    throw new AttachmentValidationError("\u0627\u0644\u0645\u0644\u0641 \u0627\u0644\u0645\u0631\u0641\u0642 \u0641\u0627\u0631\u063A \u0623\u0648 \u062A\u0627\u0644\u0641. \u064A\u0631\u062C\u0649 \u0627\u062E\u062A\u064A\u0627\u0631 \u0627\u0644\u0645\u0644\u0641 \u0645\u0631\u0629 \u0623\u062E\u0631\u0649.", {
      status: 400,
      errorCode: "EMPTY_FILE",
      stage: "backend_validate_base64"
    });
  }
  let cleanBase64 = attachment.data.trim();
  const dataUrlMatch = cleanBase64.match(/^data:([^;]+);base64,(.*)$/s);
  if (dataUrlMatch) {
    cleanBase64 = dataUrlMatch[2].trim();
  }
  cleanBase64 = cleanBase64.replace(/\s+/g, "");
  if (!cleanBase64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(cleanBase64)) {
    logAttachmentStage({
      stage: "backend_validate_base64",
      fn: "validateAndDecodeAttachment",
      fileKind: declared === "application/pdf" ? "document" : "image",
      mimeType: declared,
      sizeBytes: cleanBase64.length,
      httpStatus: 400,
      errorCode: "CORRUPTED_FILE",
      summary: "Invalid base64 encoding in attachment payload."
    });
    throw new AttachmentValidationError("\u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u0645\u0631\u0641\u0642 \u062A\u0627\u0644\u0641\u0629 \u0623\u0648 \u063A\u064A\u0631 \u0645\u0643\u062A\u0645\u0644\u0629. \u064A\u0631\u062C\u0649 \u0625\u0639\u0627\u062F\u0629 \u0627\u062E\u062A\u064A\u0627\u0631 \u0627\u0644\u0645\u0644\u0641.", {
      status: 400,
      errorCode: "CORRUPTED_FILE",
      stage: "backend_validate_base64"
    });
  }
  const buffer = Buffer.from(cleanBase64, "base64");
  const validated = validateBinaryBufferAttachment(buffer, {
    declaredMime: declared,
    name,
    maxBytes: MAX_INLINE_RAW_BYTES,
    fn: "validateAndDecodeAttachment"
  });
  logAttachmentStage({
    stage: "backend_validated",
    fn: "validateAndDecodeAttachment",
    fileKind: validated.kind,
    mimeType: validated.mimeType,
    sizeBytes: validated.sizeBytes,
    pageCount: validated.pageCount,
    transport: "inline_base64"
  });
  return {
    ...validated,
    base64: cleanBase64
  };
}
function buildInteractionAttachmentPart(validated) {
  if (!validated) return null;
  if (validated.uri) {
    return {
      type: validated.kind,
      uri: validated.uri,
      mime_type: validated.mimeType
    };
  }
  if (!validated.base64) {
    throw new AttachmentValidationError("\u062A\u0639\u0630\u0631 \u062A\u062C\u0647\u064A\u0632 \u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u0645\u0631\u0641\u0642 \u0644\u0644\u0625\u0631\u0633\u0627\u0644.", {
      status: 400,
      errorCode: "CORRUPTED_FILE",
      stage: "build_interaction_part"
    });
  }
  return {
    type: validated.kind,
    data: validated.base64,
    mime_type: validated.mimeType
  };
}
async function uploadAttachmentToGeminiFiles(ai, validated) {
  if (!ai.files?.upload) {
    throw new AttachmentValidationError("\u062E\u062F\u0645\u0629 \u0631\u0641\u0639 \u0627\u0644\u0645\u0644\u0641\u0627\u062A \u0627\u0644\u0645\u0624\u0642\u062A\u0629 \u063A\u064A\u0631 \u0645\u062A\u0627\u062D\u0629 \u062D\u0627\u0644\u064A\u064B\u0627.", {
      status: 502,
      errorCode: "UPLOAD_FAILED",
      stage: "gemini_files_upload",
      retryable: true
    });
  }
  if (!validated.buffer) {
    throw new AttachmentValidationError("\u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u0645\u0644\u0641 \u063A\u064A\u0631 \u0635\u0627\u0644\u062D\u0629 \u0644\u0644\u0631\u0641\u0639.", {
      status: 400,
      errorCode: "EMPTY_FILE",
      stage: "gemini_files_upload"
    });
  }
  const blob = new Blob([new Uint8Array(validated.buffer)], { type: validated.mimeType });
  const safeDisplayName = validated.name.replace(/[^\w.\-()\s\u0600-\u06FF]/g, "_").slice(0, 80) || "physics-attachment";
  let uploaded = await ai.files.upload({
    file: blob,
    config: {
      mimeType: validated.mimeType,
      displayName: safeDisplayName
    }
  });
  if (uploaded?.name && uploaded?.state === "PROCESSING" && ai.files.get) {
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 700));
      const checked = await ai.files.get({ name: uploaded.name });
      uploaded = checked;
      if (checked?.state !== "PROCESSING") break;
    }
  }
  if (uploaded?.state === "FAILED" || !uploaded?.uri) {
    throw new AttachmentValidationError("\u062A\u0639\u0630\u0631 \u062A\u062C\u0647\u064A\u0632 \u0627\u0644\u0645\u0644\u0641 \u0639\u0644\u0649 \u062E\u0627\u062F\u0645 Gemini Files API. \u064A\u0631\u062C\u0649 \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629 \u0645\u0631\u0629 \u0623\u062E\u0631\u0649.", {
      status: 502,
      errorCode: "UPLOAD_FAILED",
      stage: "gemini_files_upload",
      retryable: true
    });
  }
  logAttachmentStage({
    stage: "gemini_files_uploaded",
    fn: "uploadAttachmentToGeminiFiles",
    fileKind: validated.kind,
    mimeType: validated.mimeType,
    sizeBytes: validated.sizeBytes,
    pageCount: validated.pageCount,
    transport: "files_api_uri",
    httpStatus: 200
  });
  return {
    uri: String(uploaded.uri),
    fileName: String(uploaded.name || ""),
    mimeType: validated.mimeType,
    expiresAt: uploaded.expirationTime ? String(uploaded.expirationTime) : void 0
  };
}
async function deleteGeminiFileSafe(ai, fileName) {
  if (!fileName || !ai.files?.delete) return false;
  const cleaned = String(fileName).trim();
  if (!/^files\/[A-Za-z0-9_-]+$/.test(cleaned)) return false;
  try {
    await ai.files.delete({ name: cleaned });
    return true;
  } catch {
    return false;
  }
}

// server.ts
dotenv.config();
var __filename = fileURLToPath(import.meta.url);
var __dirname = path.dirname(__filename);
var app = express();
var PORT = 3e3;
app.use((_req, res, next) => {
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  next();
});
app.use(express.json({ limit: "15mb" }));
var SYSTEM_INSTRUCTION_CACHE_MAX = 200;
var systemInstructionCache = /* @__PURE__ */ new Map();
function getCachedTutorSystemInstruction(opts) {
  const key = `${opts.mode}|${opts.language}|${opts.level}|${opts.style}|${opts.detail}|${opts.track}|${opts.grade}`;
  const cached = systemInstructionCache.get(key);
  if (cached) return cached;
  const trackLabel = opts.track === "thanawiya" ? "\u0627\u0644\u062B\u0627\u0646\u0648\u064A\u0629 \u0627\u0644\u0639\u0627\u0645\u0629 \u0627\u0644\u0645\u0635\u0631\u064A\u0629 (Thanawiya Amma)" : opts.track === "baccalaureate" ? "\u0627\u0644\u0628\u0643\u0627\u0644\u0648\u0631\u064A\u0627 \u0627\u0644\u0645\u0635\u0631\u064A\u0629 (Egyptian Baccalaureate)" : "American Diploma Physics (Honors / AP Physics)";
  const modeInstructions = opts.mode === "tutor" ? "MODE: TUTOR. Explain physics clearly with Egyptian Arabic warmth and clarity (\u0623\u0633\u0644\u0648\u0628 \u0645\u062F\u0631\u0633 \u0641\u064A\u0632\u064A\u0627\u0621 \u0645\u0635\u0631\u064A \u0648\u062F\u0648\u062F \u0648\u0634\u0627\u0637\u0631), define symbols & SI units, show essential steps without skipping calculations." : opts.mode === "analyzer" ? "MODE: ANALYZER. Break down rigorously: Givens (with units), Target, SI conversions, Selected Law, Substitution, Calculation, and Unit/Sanity check." : "MODE: EXAMINER. Ask ONE conceptual or numerical question for the student track and wait for their attempt \u2014 NEVER reveal the final answer early. If grading an attempt, pinpoint exact conceptual or unit errors first, then give the next prompt.";
  const languageInstruction = opts.language === "bilingual" ? 'LANG: BILINGUAL (Arabic + English). Write clear Egyptian-friendly scientific Arabic explanation with key English terms in parentheses, then a crisp "**English Explanation:**" section.' : opts.language === "ar" ? "LANG: Arabic (\u0644\u0647\u062C\u0629 \u0645\u0635\u0631\u064A\u0629 \u062A\u0639\u0644\u064A\u0645\u064A\u0629 \u0645\u0628\u0633\u0637\u0629 \u0645\u0645\u0632\u0648\u062C\u0629 \u0628\u0627\u0644\u0645\u0635\u0637\u0644\u062D\u0627\u062A \u0627\u0644\u0639\u0644\u0645\u064A\u0629 \u0627\u0644\u062F\u0642\u064A\u0642\u0629 \u0648\u0628\u0627\u0644\u0631\u0645\u0648\u0632 \u0648\u0627\u0644\u0648\u062D\u062F\u0627\u062A \u0627\u0644\u0625\u0646\u062C\u0644\u064A\u0632\u064A\u0629 \u0628\u064A\u0646 \u0642\u0648\u0633\u064A\u0646). Understand Arabic, English, or mixed input." : "LANG: Academic English. Understand Arabic, English, or mixed input.";
  const detailInstruction = opts.detail === "concise" ? "DEPTH: DIRECT & CONCISE. Answer immediately with the core concept/law, SI units, and direct steps; avoid filler and offer to expand if the student asks." : "DEPTH: DETAILED. Provide thorough step-by-step derivations, physical intuition, and complete worked calculations.";
  const template = `You are Physics Smart AI Tutor (\u0645\u062F\u0631\u0633 \u0627\u0644\u0641\u064A\u0632\u064A\u0627\u0621 \u0627\u0644\u0630\u0643\u064A).
Track: ${trackLabel} | Grade: ${opts.grade || "General"} | Level: ${opts.level} | Style: ${opts.style}.
${languageInstruction}
${modeInstructions}
${detailInstruction}
RULES: Verify laws, constants (state assumptions like g=9.8 or 10 m/s^2), and SI units; distinguish exact vs rounded results; ask for missing values if ambiguous; maintain conversation continuity; wrap display equations in $$...$$ and inline formulas in $...$.
ATTACHMENTS: When an image or PDF is attached, carefully read all equations, graphs, diagrams, tables, and multi-page content in page order, cite page numbers when answering about a PDF, and if any part is blurry or unreadable NEVER guess\u2014tell the student clearly which part is unclear.`;
  if (systemInstructionCache.size >= SYSTEM_INSTRUCTION_CACHE_MAX) {
    const oldestKey = systemInstructionCache.keys().next().value;
    if (oldestKey) systemInstructionCache.delete(oldestKey);
  }
  systemInstructionCache.set(key, template);
  return template;
}
function buildAttachmentPart(attachment) {
  const validated = validateAndDecodeAttachment(attachment);
  return buildInteractionAttachmentPart(validated);
}
function formatCompactHistory(history) {
  if (!Array.isArray(history) || history.length === 0) return "";
  return history.slice(-6).map((h) => {
    const cleaned = String(h.text || "").trim();
    const clipped = cleaned.length > 500 ? `${cleaned.slice(0, 500)}...` : cleaned;
    return `${h.role === "user" ? "Student" : "Tutor"}: ${clipped}`;
  }).join("\n");
}
function inferErrorSource(err) {
  const summary = String(err.primaryError?.summary || "");
  if (err.errorCode === "AUTH_ERROR" && (summary.includes("API_KEY_MISSING") || summary.includes("not configured"))) {
    return "vercel_env";
  }
  if (err.errorCode === "AUTH_ERROR") {
    return "gemini_auth";
  }
  if (err.errorCode === "PERMISSION_DENIED") {
    return "gemini_permissions";
  }
  if (err.errorCode === "ATTACHMENT_REJECTED") {
    return "gemini_api";
  }
  if (err.errorCode === "BAD_REQUEST" || err.errorCode === "INTERNAL_ERROR") {
    return "backend";
  }
  return "gemini_api";
}
function buildErrorPayload(err, fallbackMessage) {
  if (err instanceof AttachmentValidationError) {
    return {
      status: err.status,
      body: {
        error: err.message,
        errorCode: err.errorCode,
        retryable: err.retryable,
        source: "backend_validation",
        stage: err.stage
      }
    };
  }
  if (err instanceof GeminiResilienceError) {
    const source = inferErrorSource(err);
    return {
      status: err.httpStatus,
      body: {
        error: err.message,
        errorCode: err.errorCode,
        retryable: err.retryable,
        source,
        model: err.meta.model,
        durationMs: err.meta.durationMs,
        primaryError: err.primaryError ? {
          category: err.primaryError.category,
          status: err.primaryError.httpStatus,
          summary: sanitizeSecret(err.primaryError.summary).slice(0, 220)
        } : null,
        fallbackError: err.fallbackError ? {
          model: err.fallbackError.model,
          category: err.fallbackError.category,
          status: err.fallbackError.httpStatus,
          summary: sanitizeSecret(err.fallbackError.summary).slice(0, 220)
        } : null
      }
    };
  }
  const status = typeof err?.status === "number" && err.status >= 100 && err.status < 600 ? err.status : 500;
  const errorCode = err?.errorCode || (status === 413 ? "FILE_TOO_LARGE" : status === 400 ? "BAD_REQUEST" : "INTERNAL_ERROR");
  const errorMsg = err?.message || fallbackMessage;
  const safeMsg = sanitizeSecret(errorMsg);
  return {
    status,
    body: {
      error: errorMsg,
      errorCode,
      retryable: status !== 400 && status !== 413 && status !== 422 && status !== 401 && status !== 403,
      source: status === 400 || status === 413 || status === 422 ? "backend_validation" : "backend",
      detail: process.env.NODE_ENV === "production" ? void 0 : safeMsg
    }
  };
}
function sendResilienceError(res, err, fallbackMessage) {
  const { status, body } = buildErrorPayload(err, fallbackMessage);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.status(status).json(body);
}
function writeSseEvent(res, event, data) {
  if (res.writableEnded) return;
  res.write(`event: ${event}
data: ${JSON.stringify(data)}

`);
}
app.get("/api/health", (_req, res) => {
  const { envVarName } = getConfiguredGeminiKey();
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  res.json({
    ok: true,
    service: "physics-smart-api",
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "development",
    vercelRegion: process.env.VERCEL_REGION || null,
    nodeVersion: process.version,
    hasGeminiKey: Boolean(envVarName),
    geminiKeyEnvVar: envVarName,
    missingEnvVars: envVarName ? [] : ["GEMINI_API_KEY"],
    primaryModel: PRIMARY_GEMINI_MODEL,
    tutorConfig: {
      streaming: true,
      detailDefault: "concise",
      thinkingDefault: "low"
    },
    resilience: getResilienceStateSnapshot()
  });
});
var AUTH_CHECK_COOLDOWN_MS = 6e4;
var AUTH_CHECK_IP_WINDOW_MS = 5 * 6e4;
var AUTH_CHECK_IP_MAX = 10;
var lastAuthCheckCache = null;
var authCheckIpHits = /* @__PURE__ */ new Map();
function getFirebaseWebApiKey() {
  try {
    const candidates = [
      path.resolve(__dirname, "firebase-applet-config.json"),
      path.resolve(process.cwd(), "firebase-applet-config.json")
    ];
    for (const filePath of candidates) {
      if (fs.existsSync(filePath)) {
        const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
        if (typeof parsed?.apiKey === "string" && parsed.apiKey.trim()) {
          return parsed.apiKey.trim();
        }
      }
    }
  } catch {
  }
  return null;
}
async function isAuthorizedForDiagnosticProbe(req) {
  if (process.env.NODE_ENV !== "production" && process.env.VERCEL_ENV !== "production") {
    return true;
  }
  const configuredToken = process.env.AI_DIAGNOSTIC_TOKEN?.trim();
  const headerToken = String(req.headers["x-diagnostic-token"] || "").trim();
  if (configuredToken && headerToken && headerToken === configuredToken) {
    return true;
  }
  const authHeader = String(req.headers.authorization || "");
  if (authHeader.startsWith("Bearer ")) {
    const idToken = authHeader.slice(7).trim();
    const firebaseApiKey = getFirebaseWebApiKey();
    if (idToken && firebaseApiKey) {
      try {
        const resp = await fetch(
          `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(firebaseApiKey)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ idToken })
          }
        );
        if (resp.ok) {
          const data = await resp.json();
          if (Array.isArray(data?.users) && data.users.length > 0) {
            return true;
          }
        }
      } catch {
        return false;
      }
    }
  }
  return false;
}
app.get("/api/ai/auth-check", async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  const authorized = await isAuthorizedForDiagnosticProbe(req);
  if (!authorized) {
    res.status(401).json({
      ok: false,
      errorCode: "AUTH_REQUIRED",
      error: "Authentication (Firebase ID token or diagnostic token) is required to run live Gemini connectivity check."
    });
    return;
  }
  const now = Date.now();
  const clientIp = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim();
  const recentHits = (authCheckIpHits.get(clientIp) || []).filter((ts) => now - ts < AUTH_CHECK_IP_WINDOW_MS);
  if (recentHits.length >= AUTH_CHECK_IP_MAX) {
    res.status(429).json({
      ok: false,
      errorCode: "DIAGNOSTIC_RATE_LIMIT",
      error: "Too many diagnostic requests. Please wait a few minutes before retrying."
    });
    return;
  }
  recentHits.push(now);
  authCheckIpHits.set(clientIp, recentHits);
  if (lastAuthCheckCache && now < lastAuthCheckCache.expiresAt && req.query.fresh !== "1") {
    res.status(lastAuthCheckCache.report.ok ? 200 : lastAuthCheckCache.report.httpStatus).json({
      ...lastAuthCheckCache.report,
      cached: true
    });
    return;
  }
  const clientFactory = app.locals?.geminiClientFactory;
  const report = await verifyGeminiAuthAndConnectivity(clientFactory);
  lastAuthCheckCache = {
    expiresAt: now + AUTH_CHECK_COOLDOWN_MS,
    report
  };
  res.status(report.ok ? 200 : report.httpStatus).json({
    ...report,
    cached: false
  });
});
app.post("/api/math/verify", (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  try {
    const { expression, expected, tolerance = 0.02 } = req.body;
    if (!expression || typeof expression !== "string") {
      res.status(400).json({ error: "Expression is required." });
      return;
    }
    const result = evaluate(expression);
    const numericResult = typeof result === "number" ? result : Number(result);
    if (!Number.isFinite(numericResult)) {
      res.status(400).json({ error: "Expression did not evaluate to a finite number." });
      return;
    }
    const isMatch = typeof expected === "number" ? Math.abs(numericResult - expected) <= Math.max(Math.abs(expected) * tolerance, 1e-6) : null;
    res.json({ result: numericResult, isMatch });
  } catch (err) {
    res.status(400).json({ error: err?.message || "Math evaluation error" });
  }
});
app.post(
  "/api/ai/files/upload",
  express.raw({
    type: ["application/pdf", "image/jpeg", "image/png", "image/webp", "application/octet-stream"],
    limit: "4.3mb"
  }),
  async (req, res) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    const declaredMime = String(req.headers["x-file-mime"] || req.headers["content-type"] || "");
    const rawName = String(req.headers["x-file-name"] || "attachment");
    let fileNameDecoded = rawName;
    try {
      fileNameDecoded = decodeURIComponent(rawName);
    } catch {
    }
    try {
      const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const validated = validateBinaryBufferAttachment(buffer, {
        declaredMime,
        name: fileNameDecoded,
        fn: "POST /api/ai/files/upload"
      });
      const clientFactory = app.locals?.geminiClientFactory;
      const ai = clientFactory ? clientFactory() : createGeminiClient();
      const uploaded = await uploadAttachmentToGeminiFiles(ai, validated);
      res.status(200).json({
        ok: true,
        uri: uploaded.uri,
        fileName: uploaded.fileName,
        mimeType: uploaded.mimeType,
        sizeBytes: validated.sizeBytes,
        pageCount: validated.pageCount ?? null,
        expiresAt: uploaded.expiresAt ?? null
      });
    } catch (err) {
      if (err instanceof AttachmentValidationError) {
        const { status, body } = buildErrorPayload(err, err.message);
        res.status(status).json(body);
        return;
      }
      const classified = classifyGeminiError(err);
      logAttachmentStage({
        stage: "gemini_files_upload_error",
        fn: "POST /api/ai/files/upload",
        fileKind: declaredMime.includes("pdf") ? "document" : "image",
        mimeType: declaredMime,
        sizeBytes: Buffer.isBuffer(req.body) ? req.body.length : 0,
        transport: "binary_upload",
        httpStatus: classified.httpStatus,
        errorCode: classified.category === "auth_error" ? "AUTH_ERROR" : classified.category === "permission_denied" ? "PERMISSION_DENIED" : "UPLOAD_FAILED",
        summary: classified.rawSummary
      });
      const isAuth = classified.category === "auth_error" || classified.category === "permission_denied";
      res.status(isAuth ? classified.httpStatus : 502).json({
        error: isAuth ? classified.safeMessage : "\u062A\u0639\u0630\u0631 \u0631\u0641\u0639 \u0627\u0644\u0645\u0644\u0641 \u0625\u0644\u0649 \u062E\u0627\u062F\u0645 Gemini \u0627\u0644\u0645\u0624\u0642\u062A \u062D\u0627\u0644\u064A\u064B\u0627. \u064A\u0645\u0643\u0646\u0643 \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629 \u0645\u0631\u0629 \u0623\u062E\u0631\u0649.",
        errorCode: classified.category === "auth_error" ? "AUTH_ERROR" : classified.category === "permission_denied" ? "PERMISSION_DENIED" : "UPLOAD_FAILED",
        retryable: !isAuth,
        source: isAuth ? "gemini_auth" : "gemini_api"
      });
    }
  }
);
app.delete("/api/ai/files", async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  const fileName = String(req.body?.fileName || req.query?.fileName || "").trim();
  if (!fileName) {
    res.status(400).json({ ok: false, errorCode: "BAD_REQUEST", error: "fileName is required." });
    return;
  }
  try {
    const clientFactory = app.locals?.geminiClientFactory;
    const ai = clientFactory ? clientFactory() : createGeminiClient();
    const deleted = await deleteGeminiFileSafe(ai, fileName);
    res.json({ ok: deleted });
  } catch {
    res.json({ ok: false });
  }
});
app.post("/api/ai/tutor", async (req, res) => {
  const reqStart = Date.now();
  const wantsStream = req.body?.stream === true || String(req.headers.accept || "").includes("text/event-stream");
  const clientFactory = app.locals?.geminiClientFactory;
  try {
    const {
      message,
      mode = "tutor",
      language = "ar",
      level = "intermediate",
      style = "conceptual",
      detail = "concise",
      track = "thanawiya",
      grade = "",
      lessonContext = "",
      history = [],
      previousInteractionId,
      attachment
    } = req.body;
    if (!message && !attachment) {
      res.status(400).json({ error: "Message or attachment is required.", errorCode: "BAD_REQUEST", retryable: false });
      return;
    }
    const baseInstruction = getCachedTutorSystemInstruction({
      mode,
      language,
      level,
      style,
      detail,
      track,
      grade
    });
    const trimmedContext = lessonContext ? String(lessonContext).trim().slice(0, 1200) : "";
    const systemInstruction = trimmedContext ? `${baseInstruction}
LESSON CONTEXT:
${trimmedContext}` : baseInstruction;
    const attachmentPart = buildAttachmentPart(attachment);
    const currentMessageText = message || (language === "ar" ? "\u062D\u0644\u0644 \u0627\u0644\u0645\u0631\u0641\u0642 \u0627\u0644\u062A\u0627\u0644\u064A." : "Analyze attachment.");
    const conversationTranscript = formatCompactHistory(history);
    const transcriptText = conversationTranscript ? `Previous Conversation:
${conversationTranscript}

Student:
${currentMessageText}` : currentMessageText;
    const currentOnlyInput = attachmentPart ? [attachmentPart, { type: "text", text: currentMessageText }] : currentMessageText;
    const fullContextInput = attachmentPart ? [attachmentPart, { type: "text", text: transcriptText }] : transcriptText;
    const thinkingLevel = detail === "detailed" ? "medium" : "low";
    const backendPrepMs = Date.now() - reqStart;
    if (wantsStream) {
      res.status(200);
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      if (typeof res.flushHeaders === "function") {
        res.flushHeaders();
      }
      const streamAbort = new AbortController();
      res.on("close", () => {
        if (!res.writableEnded) {
          streamAbort.abort(new Error("Client closed SSE connection"));
        }
      });
      try {
        const result2 = await executeGeminiInteractionStreamWithResilience(
          {
            input: previousInteractionId ? currentOnlyInput : fullContextInput,
            inputWithoutPreviousId: fullContextInput,
            system_instruction: systemInstruction,
            previous_interaction_id: previousInteractionId || void 0,
            thinking_level: thinkingLevel
          },
          {
            onFirstToken: (info) => {
              writeSseEvent(res, "meta", {
                model: info.model,
                usedFallback: info.usedFallback,
                attempts: info.attempts,
                ttftMs: info.ttftMs + backendPrepMs,
                backendPrepMs
              });
            },
            onDelta: (chunk) => {
              writeSseEvent(res, "delta", { text: chunk });
            }
          },
          {
            endpoint: "/api/ai/tutor",
            signal: streamAbort.signal,
            clientFactory
          }
        );
        writeSseEvent(res, "done", {
          reply: result2.text,
          interactionId: result2.interactionId,
          meta: {
            model: result2.meta.model,
            usedFallback: result2.meta.usedFallback,
            attempts: result2.meta.attempts,
            ttftMs: (result2.meta.ttftMs ?? 0) + backendPrepMs,
            durationMs: result2.meta.durationMs + backendPrepMs,
            backendPrepMs
          }
        });
        res.end();
      } catch (streamErr) {
        if (!streamAbort.signal.aborted) {
          const { status, body } = buildErrorPayload(
            streamErr,
            "\u062A\u0639\u0630\u0631 \u0627\u0644\u062D\u0635\u0648\u0644 \u0639\u0644\u0649 \u0631\u062F \u0645\u0646 \u0627\u0644\u0645\u062F\u0631\u0633 \u0627\u0644\u0630\u0643\u064A \u062D\u0627\u0644\u064A\u064B\u0627. \u064A\u0631\u062C\u0649 \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629 \u0645\u0631\u0629 \u0623\u062E\u0631\u0649."
          );
          console.error(
            "[TutorAPI Error]",
            JSON.stringify({
              endpoint: "/api/ai/tutor",
              stream: true,
              environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "development",
              httpStatus: status,
              errorCode: body.errorCode,
              source: body.source,
              model: body.model,
              durationMs: Date.now() - reqStart,
              detail: sanitizeSecret(streamErr?.message || "Unknown error")
            })
          );
          writeSseEvent(res, "error", { status, ...body });
        }
        if (!res.writableEnded) {
          res.end();
        }
      }
      return;
    }
    const result = await executeGeminiInteractionWithResilience(
      {
        input: previousInteractionId ? currentOnlyInput : fullContextInput,
        inputWithoutPreviousId: fullContextInput,
        system_instruction: systemInstruction,
        previous_interaction_id: previousInteractionId || void 0,
        thinking_level: thinkingLevel
      },
      { endpoint: "/api/ai/tutor", clientFactory }
    );
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.json({
      reply: result.text,
      interactionId: result.interaction?.id || null,
      meta: {
        model: result.meta.model,
        usedFallback: result.meta.usedFallback,
        attempts: result.meta.attempts,
        durationMs: result.meta.durationMs + backendPrepMs,
        backendPrepMs
      }
    });
  } catch (err) {
    const { status, body } = buildErrorPayload(
      err,
      "\u062A\u0639\u0630\u0631 \u0627\u0644\u062D\u0635\u0648\u0644 \u0639\u0644\u0649 \u0631\u062F \u0645\u0646 \u0627\u0644\u0645\u062F\u0631\u0633 \u0627\u0644\u0630\u0643\u064A \u062D\u0627\u0644\u064A\u064B\u0627. \u064A\u0631\u062C\u0649 \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629 \u0645\u0631\u0629 \u0623\u062E\u0631\u0649."
    );
    console.error(
      "[TutorAPI Error]",
      JSON.stringify({
        endpoint: "/api/ai/tutor",
        stream: wantsStream,
        environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "development",
        httpStatus: status,
        errorCode: body.errorCode,
        source: body.source,
        model: body.model,
        durationMs: Date.now() - reqStart,
        detail: sanitizeSecret(err?.message || "Unknown error")
      })
    );
    sendResilienceError(res, err, "\u062A\u0639\u0630\u0631 \u0627\u0644\u062D\u0635\u0648\u0644 \u0639\u0644\u0649 \u0631\u062F \u0645\u0646 \u0627\u0644\u0645\u062F\u0631\u0633 \u0627\u0644\u0630\u0643\u064A \u062D\u0627\u0644\u064A\u064B\u0627. \u064A\u0631\u062C\u0649 \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629 \u0645\u0631\u0629 \u0623\u062E\u0631\u0649.");
  }
});
app.post("/api/ai/solver", async (req, res) => {
  const clientFactory = app.locals?.geminiClientFactory;
  try {
    const {
      problemText = "",
      manualGivens = [],
      manualTarget = "",
      language = "ar",
      track = "thanawiya",
      attachment
    } = req.body;
    if (!problemText.trim() && manualGivens.length === 0 && !attachment) {
      res.status(400).json({
        error: "Please provide a problem statement, manual givens, or an image/PDF.",
        errorCode: "BAD_REQUEST",
        retryable: false
      });
      return;
    }
    const givensSummary = manualGivens.length > 0 ? `
Manual Givens:
${manualGivens.map((g) => `- ${g.symbol} = ${g.value} ${g.unit}`).join("\n")}
Target: ${manualTarget}` : "";
    const solverLangDesc = language === "bilingual" ? "BOTH Arabic and English (Bilingual mode): for every narrative field, write a clear scientific Arabic line first followed by a newline and the matching English translation/terminology on the next line" : language === "ar" ? "Arabic (with clear Egyptian physics teacher clarity, standard English physics symbols/LaTeX, and SI units)" : "English";
    const prompt = `Analyze and solve the following physics problem for the ${track} curriculum in ${solverLangDesc}.
If the problem is unclear or missing critical numerical data, set needsClarification=true and explain what is missing in clarificationQuestion.
Otherwise, provide all 11 pedagogical steps accurately without skipping any derivation or arithmetic step, plus a pure numeric mathjs-compatible arithmetic expression in "verificationExpression" (using only numbers, +, -, *, /, ^, sqrt, sin, cos, tan, pi) so our deterministic math engine can verify the final scalar result!

Problem:
${problemText}
${givensSummary}`;
    const attachmentPart = buildAttachmentPart(attachment);
    const solverInput = attachmentPart ? [attachmentPart, { type: "text", text: prompt }] : prompt;
    const result = await executeGeminiInteractionWithResilience(
      {
        input: solverInput,
        system_instruction: "You are an exact Physics Problem Solver. Verify every unit conversion, state assumptions (like g=9.8 m/s^2), use standard LaTeX for formulas, and ensure arithmetic in verificationExpression matches the final numerical answer.",
        response_format: {
          type: Type.OBJECT,
          properties: {
            needsClarification: { type: Type.BOOLEAN },
            clarificationQuestion: { type: Type.STRING },
            understanding: { type: Type.STRING },
            givens: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  symbol: { type: Type.STRING },
                  value: { type: Type.STRING },
                  unit: { type: Type.STRING },
                  meaning: { type: Type.STRING }
                }
              }
            },
            target: { type: Type.STRING },
            unitConversions: { type: Type.STRING },
            selectedFormulaLatex: { type: Type.STRING },
            formulaReason: { type: Type.STRING },
            substitutionLatex: { type: Type.STRING },
            calculations: { type: Type.STRING },
            verificationExpression: { type: Type.STRING },
            finalNumericValue: { type: Type.NUMBER },
            finalAnswerText: { type: Type.STRING },
            unit: { type: Type.STRING },
            sanityCheck: { type: Type.STRING }
          },
          required: [
            "needsClarification",
            "understanding",
            "givens",
            "target",
            "unitConversions",
            "selectedFormulaLatex",
            "formulaReason",
            "substitutionLatex",
            "calculations",
            "finalAnswerText",
            "unit",
            "sanityCheck"
          ]
        },
        thinking_level: "low"
      },
      { endpoint: "/api/ai/solver", timeoutMs: 32e3, clientFactory }
    );
    const fullOutput = result.text;
    let parsed = {};
    try {
      const jsonMatch = fullOutput.match(/```json\s*([\s\S]*?)\s*```/) || fullOutput.match(/([\{\[][\s\S]*[\}\]])/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[1]);
      } else {
        parsed = JSON.parse(fullOutput);
      }
    } catch {
      console.error("Solver JSON parse error on output length:", fullOutput.length);
      parsed = {
        needsClarification: false,
        understanding: fullOutput,
        givens: [],
        target: "",
        unitConversions: "",
        selectedFormulaLatex: "",
        formulaReason: "",
        substitutionLatex: "",
        calculations: "",
        finalAnswerText: "Parsed output",
        unit: "",
        sanityCheck: ""
      };
    }
    let mathVerification = {
      verified: false
    };
    if (parsed.verificationExpression && typeof parsed.verificationExpression === "string") {
      try {
        const evalResult = evaluate(parsed.verificationExpression);
        const engineNum = typeof evalResult === "number" ? evalResult : Number(evalResult);
        if (Number.isFinite(engineNum)) {
          const matches = typeof parsed.finalNumericValue === "number" ? Math.abs(engineNum - parsed.finalNumericValue) <= Math.max(Math.abs(engineNum) * 0.02, 1e-4) : true;
          mathVerification = {
            verified: matches,
            engineValue: Number(engineNum.toPrecision(6)),
            expression: parsed.verificationExpression,
            note: matches ? "Verified by Math.js engine" : "Engine recalculated exact value"
          };
        }
      } catch {
        mathVerification = { verified: false, note: "Symbolic or non-scalar expression" };
      }
    }
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.json({
      solution: parsed,
      mathVerification,
      meta: {
        model: result.meta.model,
        usedFallback: result.meta.usedFallback,
        attempts: result.meta.attempts,
        durationMs: result.meta.durationMs
      }
    });
  } catch (err) {
    console.error("Solver Error:", sanitizeSecret(err?.message || "Unknown error"));
    sendResilienceError(res, err, "\u062A\u0639\u0630\u0631 \u062D\u0644 \u0627\u0644\u0645\u0633\u0623\u0644\u0629 \u062D\u0627\u0644\u064A\u064B\u0627 \u0628\u0633\u0628\u0628 \u0636\u063A\u0637 \u0645\u0624\u0642\u062A. \u064A\u0631\u062C\u0649 \u0625\u0639\u0627\u062F\u0629 \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629.");
  }
});
app.post("/api/ai/solver/explain-step", async (req, res) => {
  const clientFactory = app.locals?.geminiClientFactory;
  try {
    const { stepTitle, stepContent, problemContext, language = "ar" } = req.body;
    const stepLangPrompt = language === "bilingual" ? "Bilingual (Egyptian-friendly clear Arabic explanation first, followed by a crisp English explanation section)" : language === "ar" ? "Arabic (\u0623\u0633\u0644\u0648\u0628 \u0645\u062F\u0631\u0633 \u0641\u064A\u0632\u064A\u0627\u0621 \u0645\u0635\u0631\u064A \u0645\u0628\u0633\u0637 \u0648\u0648\u0627\u0636\u062D \u0645\u0639 \u0627\u0644\u0645\u0635\u0637\u0644\u062D\u0627\u062A \u0627\u0644\u0625\u0646\u062C\u0644\u064A\u0632\u064A\u0629 \u0628\u064A\u0646 \u0642\u0648\u0633\u064A\u0646)" : "English";
    const result = await executeGeminiInteractionWithResilience(
      {
        input: `Explain this specific physics solution step clearly for a student who wants deeper understanding.
Language: ${stepLangPrompt}
Step: ${stepTitle}
Step Content: ${stepContent}
Original Problem Context: ${problemContext}
Use clean LaTeX ($...$ or $$...$$) and verify all units without skipping steps.`,
        thinking_level: "low"
      },
      { endpoint: "/api/ai/solver/explain-step", clientFactory }
    );
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.json({
      explanation: result.text,
      meta: {
        model: result.meta.model,
        usedFallback: result.meta.usedFallback,
        attempts: result.meta.attempts,
        durationMs: result.meta.durationMs
      }
    });
  } catch (err) {
    console.error("Explain Step Error:", sanitizeSecret(err?.message || "Unknown error"));
    sendResilienceError(res, err, "\u062A\u0639\u0630\u0631 \u0634\u0631\u062D \u0647\u0630\u0647 \u0627\u0644\u062E\u0637\u0648\u0629 \u062D\u0627\u0644\u064A\u064B\u0627. \u064A\u0631\u062C\u0649 \u0625\u0639\u0627\u062F\u0629 \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629.");
  }
});
app.use("/api", (_req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.status(404).json({ error: "API endpoint not found.", errorCode: "NOT_FOUND", retryable: false });
});
app.use((err, req, res, next) => {
  if (req.path.startsWith("/api/")) {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    const status = typeof err?.status === "number" ? err.status : 400;
    res.status(status).json({
      error: status === 413 ? "\u062D\u062C\u0645 \u0627\u0644\u0645\u0631\u0641\u0642 \u0623\u0643\u0628\u0631 \u0645\u0646 \u0627\u0644\u062D\u062F \u0627\u0644\u0645\u0633\u0645\u0648\u062D." : "\u0635\u064A\u063A\u0629 \u0627\u0644\u0637\u0644\u0628 \u063A\u064A\u0631 \u0635\u0627\u0644\u062D\u0629.",
      errorCode: "BAD_REQUEST",
      retryable: false
    });
    return;
  }
  next(err);
});
async function startServer() {
  if (process.env.VERCEL || process.env.NODE_ENV === "test" || process.env.DISABLE_AUTO_LISTEN === "true") {
    return;
  }
  const httpServer = http.createServer(app);
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        ws: { server: httpServer }
      },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }
  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Physics Smart server listening on http://localhost:${PORT}`);
  });
}
startServer();
var server_default = app;
export {
  server_default as default
};
