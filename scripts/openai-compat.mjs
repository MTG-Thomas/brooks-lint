/**
 * OpenAI-compatible completion client for the OpenCode gateways (Zen and Go)
 * and any other endpoint that speaks `/chat/completions` or `/responses`.
 *
 * Deliberately dependency-free (global fetch): OpenCode mode must run without
 * node_modules, so the GitHub Action can skip installing the Anthropic SDK
 * entirely when it is not talking to Anthropic.
 *
 * Model families are split across two endpoints on these gateways — Kimi,
 * DeepSeek, GLM, MiMo and LongCat serve `/chat/completions` while GPT, Grok
 * and Muse serve `/responses` — so the protocol is part of every call here.
 */

export const OPENCODE_DEFAULT_BASE_URL = "https://opencode.ai/zen/go/v1";

export const API_PROTOCOLS = ["auto", "chat", "responses"];

const ENDPOINT_PATH = { chat: "chat/completions", responses: "responses" };

export function completionUrl(baseURL, protocol = "chat") {
  const path = ENDPOINT_PATH[protocol] ?? ENDPOINT_PATH.chat;
  return `${String(baseURL).replace(/\/+$/, "")}/${path}`;
}

/**
 * Which endpoint serves this model. An explicit protocol always wins; "auto"
 * maps the model families that the OpenCode gateways expose only over the
 * Responses endpoint (gpt-*, grok-*, muse-*), everything else to chat.
 */
export function resolveApiProtocol(model, requested = "auto") {
  if (requested !== "auto") return requested;
  return /^(gpt-|grok-|muse-)/.test(String(model)) ? "responses" : "chat";
}

export function buildCompletionRequest(protocol, { model, system, user, maxTokens = 4096 }) {
  if (protocol === "responses") {
    return {
      model,
      instructions: system,
      input: user,
      max_output_tokens: maxTokens,
    };
  }
  return {
    model,
    max_tokens: maxTokens,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };
}

/**
 * First-choice assistant text for either protocol. Chat content is a string
 * on classic servers and an array of typed parts on newer ones; Responses
 * nests text inside output message items alongside reasoning items. Every one
 * of those shapes must be handled or a valid answer parses as an empty report.
 */
export function extractCompletionText(protocol, payload) {
  if (protocol === "responses") {
    const output = Array.isArray(payload?.output) ? payload.output : [];
    const texts = [];
    for (const item of output) {
      if (item?.type !== "message" || !Array.isArray(item.content)) continue;
      for (const part of item.content) {
        if ((part?.type === "output_text" || part?.type === "text") && typeof part.text === "string") {
          texts.push(part.text);
        }
      }
    }
    if (texts.length > 0) return texts.join("");
    // Some gateways expose a top-level convenience field instead.
    return typeof payload?.output_text === "string" ? payload.output_text : "";
  }

  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((part) => part?.type === "text" && typeof part.text === "string")
      .map((part) => part.text)
      .join("");
  }
  return "";
}

/**
 * POST one non-streaming completion on the given protocol. OpenCode's
 * gateway asks clients to send a first-party User-Agent and a stable session
 * id (prompt-cache routing), so both are forwarded when provided.
 */
export async function postCompletion({
  protocol = "chat",
  baseURL = OPENCODE_DEFAULT_BASE_URL,
  apiKey,
  model,
  system,
  user,
  maxTokens,
  session,
  userAgent,
  fetchImpl = fetch,
}) {
  const url = completionUrl(baseURL, protocol);
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
      ...(session ? { "x-opencode-session": session } : {}),
      ...(userAgent ? { "user-agent": userAgent } : {}),
    },
    body: JSON.stringify(buildCompletionRequest(protocol, { model, system, user, maxTokens })),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const detail = body ? ` — ${body.slice(0, 500)}` : "";
    throw new Error(`POST ${url} failed: HTTP ${response.status} ${response.statusText}${detail}`);
  }
  return response.json();
}
