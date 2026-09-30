/**
 * CI entry point — runs a brooks-lint mode via the Anthropic SDK or the
 * OpenCode gateways (Zen/Go) over OpenAI-compatible chat completions.
 * Shared prompt assembly with run-evals-live.mjs (via assemble-prompt.mjs).
 *
 * Reads git diff from the project, assembles the system prompt for the mode,
 * calls the model API, and outputs JSON { report, score, mode, scope, trend,
 * findings, previousScore, delta } to stdout. With --format sarif it emits a
 * SARIF 2.1.0 log instead (for GitHub Code Scanning).
 *
 * Usage:
 *   node scripts/ci-review.mjs \
 *     --mode review \
 *     [--provider anthropic|opencode] \
 *     [--model claude-sonnet-4-6] \
 *     [--api-protocol auto|chat|responses] \
 *     --skills-dir ./skills \
 *     --project-dir /path/to/project \
 *     [--format json|sarif] \
 *     [--sarif-out brooks-lint.sarif]
 *
 * Environment:
 *   ANTHROPIC_API_KEY   required unless OPENCODE_API_KEY is set
 *   OPENCODE_API_KEY    selects the OpenCode provider when Anthropic's is absent
 *   OPENCODE_BASE_URL   optional gateway base (default https://opencode.ai/zen/go/v1)
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assembleSystemPrompt, VALID_MODES } from "./assemble-prompt.mjs";
import { readHistory, getTrend } from "./history.mjs";
import { CI_REPORT_INSTRUCTIONS, validateReviewReport } from "./ci-report.mjs";
import { reportToSarif } from "./sarif.mjs";
import { parseArgs } from "./cli-utils.mjs";
import {
  API_PROTOCOLS,
  OPENCODE_DEFAULT_BASE_URL,
  extractCompletionText,
  postCompletion,
  resolveApiProtocol,
} from "./openai-compat.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const args = parseArgs(process.argv.slice(2));

const mode = args.mode ?? "review";
const provider = args.provider ?? (
  process.env.OPENCODE_API_KEY && !process.env.ANTHROPIC_API_KEY ? "opencode" : "anthropic"
);
const model = args.model ?? (provider === "opencode" ? null : "claude-sonnet-4-6");
const format = args.format ?? "json";
const apiProtocol = args["api-protocol"] ?? "auto";
const skillsDir = path.resolve(args["skills-dir"] ?? path.join(__dirname, "..", "skills"));
const projectDir = path.resolve(args["project-dir"] ?? process.cwd());
const toolVersion = JSON.parse(
  readFileSync(path.join(__dirname, "..", "package.json"), "utf8"),
).version;

if (!VALID_MODES.includes(mode)) {
  console.error(`Unknown mode: ${mode}. Valid modes: ${VALID_MODES.join(", ")}`);
  process.exit(1);
}

if (!["anthropic", "opencode"].includes(provider)) {
  console.error(`Unknown provider: ${provider}. Valid providers: anthropic, opencode`);
  process.exit(1);
}

if (provider === "opencode" && !model) {
  console.error("OpenCode mode requires --model (e.g. kimi-k3, deepseek-v4-flash, glm-5.3)");
  process.exit(1);
}

if (provider === "opencode" && !process.env.OPENCODE_API_KEY) {
  console.error("OpenCode mode requires OPENCODE_API_KEY");
  process.exit(1);
}

if (!["json", "sarif"].includes(format)) {
  console.error(`Unknown format: ${format}. Valid formats: json, sarif`);
  process.exit(1);
}

if (!API_PROTOCOLS.includes(apiProtocol)) {
  console.error(`Unknown api protocol: ${apiProtocol}. Valid protocols: ${API_PROTOCOLS.join(", ")}`);
  process.exit(1);
}

// ── Read git diff ─────────────────────────────────────────────────────────────

function getGitDiff(projectRoot) {
  const run = (cmd, cmdArgs) => {
    try {
      return execFileSync(cmd, cmdArgs, { cwd: projectRoot, encoding: "utf8" });
    } catch {
      return "";
    }
  };

  const staged = run("git", ["diff", "--cached"]);
  if (staged.trim()) return { diff: staged, scope: "staged changes (git diff --cached)" };

  const unstaged = run("git", ["diff"]);
  if (unstaged.trim()) return { diff: unstaged, scope: "unstaged changes (git diff)" };

  const branch = run("git", ["diff", "main...HEAD"]);
  if (branch.trim()) return { diff: branch, scope: "branch changes vs main (git diff main...HEAD)" };

  return { diff: "", scope: "no diff detected — full codebase scan" };
}

// ── Main ──────────────────────────────────────────────────────────────────────

const { diff, scope } = getGitDiff(projectDir);
const systemPrompt = `${assembleSystemPrompt(mode, skillsDir, projectDir)}\n${CI_REPORT_INSTRUCTIONS}`;

const userMessage = diff
  ? `Run brooks-lint ${mode} mode on the following diff.\n\nScope: ${scope}\n\n\`\`\`diff\n${diff}\n\`\`\``
  : `Run brooks-lint ${mode} mode on this project.\n\nScope: ${scope}`;

let report;
if (provider === "opencode") {
  const protocol = resolveApiProtocol(model, apiProtocol);
  try {
    const payload = await postCompletion({
      protocol,
      baseURL: process.env.OPENCODE_BASE_URL ?? OPENCODE_DEFAULT_BASE_URL,
      apiKey: process.env.OPENCODE_API_KEY,
      model,
      system: systemPrompt,
      user: userMessage,
      // Responses models reason before answering and bill those tokens
      // against the same cap, so they need more headroom than chat replies.
      maxTokens: protocol === "responses" ? 8192 : 4096,
      session: `brooks-lint-${mode}-${process.env.GITHUB_RUN_ID ?? "local"}`,
      userAgent: `brooks-lint/${toolVersion}`,
    });
    const completion = protocol === "responses" ? payload.status : payload.choices?.[0]?.finish_reason;
    const expected = protocol === "responses" ? "completed" : "stop";
    if (completion != null && completion !== expected) {
      throw new Error(`Review did not complete (${completion}); no CI result was produced`);
    }
    report = extractCompletionText(protocol, payload);
  } catch (err) {
    console.error(JSON.stringify({ error: err.message, mode, scope }, null, 2));
    process.exit(1);
  }
} else {
  // Imported lazily so OpenCode mode runs without node_modules present.
  let message;
  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic();
    message = await client.messages.create({
      model,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });
    if (message.stop_reason !== "end_turn") {
      throw new Error(`Review did not complete (${message.stop_reason}); no CI result was produced`);
    }
  } catch (err) {
    console.error(JSON.stringify({ error: err.message, mode, scope }, null, 2));
    process.exit(1);
  }
  // The first block is not always the text one — an endpoint that returns a
  // thinking block first would otherwise yield undefined.
  report = message.content.find((block) => block.type === "text")?.text ?? "";
}

let score, findings;
try {
  ({ score, findings } = validateReviewReport(report));
} catch (err) {
  console.error(JSON.stringify({ error: err.message, mode, scope }, null, 2));
  process.exit(1);
}

const trend = getTrend(readHistory(projectDir), mode);
const previousScore = trend ? trend.lastScore : null;
const delta = trend && score !== null ? score - previousScore : null;

let trendNote;
if (!trend) {
  trendNote = "First CI run — no trend data";
} else if (score === null) {
  trendNote = "Score unavailable — cannot compute trend";
} else {
  trendNote = delta === 0
    ? `Stable at ${score} over last ${trend.runCount} runs`
    : `${previousScore} → ${score} (${delta > 0 ? "+" : ""}${delta}) over last ${trend.runCount} runs`;
}

// SARIF is needed if either the stdout format is sarif or --sarif-out is set.
const needsSarif = format === "sarif" || args["sarif-out"];
const sarif = needsSarif
  ? JSON.stringify(reportToSarif(report, { mode, toolVersion }), null, 2)
  : null;

// --sarif-out writes a SARIF file regardless of the stdout format, so the Action
// can keep emitting JSON (for the PR comment + gates) and still upload SARIF.
if (args["sarif-out"]) {
  writeFileSync(path.resolve(args["sarif-out"]), sarif + "\n");
}

if (format === "sarif") {
  console.log(sarif);
} else {
  console.log(JSON.stringify(
    { report, score, mode, scope, trend: trendNote, findings, previousScore, delta },
    null,
    2,
  ));
}
