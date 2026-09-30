import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { assertFindingCounts, validateReviewReport, validateGateReport } from "./ci-report.mjs";
import { VALID_MODES } from "./assemble-prompt.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ZERO = { critical: 0, warning: 0, suggestion: 0 };
function review(body = "No findings.", score = 100) {
  return `# Brooks-Lint Review\n**Health Score:** ${score}/100\n\n## Findings\n${body}\n\n## Summary\nReviewed the supplied changes.\n\nReview status: complete`;
}
const FINDING = `### Warning\n**Cognitive Overload — Unclear configuration**\nSymptom: src/config.js:12 uses an unexplained constant.\nSource: Code Complete — Naming.\nConsequence: A configuration change can use the wrong unit.\nRemedy: Give the constant a unit-bearing name.`;

test("an explicit completed clean review yields zero findings", () => {
  assert.deepEqual(validateReviewReport(review()), { score: 100, findings: ZERO });
  assert.deepEqual(validateReviewReport(review().replaceAll("\n", "\r\n")), { score: 100, findings: ZERO });
});

test("complete findings use the same counts as the SARIF parser", () => {
  assert.deepEqual(validateReviewReport(review(FINDING, 95)), {
    score: 95, findings: { critical: 0, warning: 1, suggestion: 0 },
  });
  assert.equal(validateReviewReport(review(FINDING.replace("### Warning", "### 🟡 Warning"), 95)).findings.warning, 1);
});

for (const [name, report] of [
  ["empty", ""], ["whitespace", "  \n"], ["non-text", {}],
  ["refusal", "I cannot inspect this repository."],
  ["score alone", "Health Score: 100/100"],
  ["missing completion", review().replace("Review status: complete", "")],
  ["empty findings", review("")],
  ["ambiguous clean", review("Looks good to me.")],
  ["unparsed heading", review(FINDING.replace("### Warning", "### High priority"), 95)],
  ["unparsed title", review(FINDING.replace("**Cognitive Overload — Unclear configuration**", "- Cognitive Overload"), 95)],
  ["incomplete finding", review(FINDING.replace(/Remedy:.+/, ""), 95)],
  ["empty field", review(FINDING.replace(/Source:.+/, "Source:"), 95)],
  ["duplicate field", review(FINDING.replace("Remedy:", "Consequence:"), 95)],
  ["unparsed second finding", review(`${FINDING}\n### Broken heading\n${FINDING}`, 90)],
  ["contradictory clean", review(`${FINDING}\nNo findings.`, 95)],
  ["empty severity group", review("### Warning")],
  ["missing summary", review().replace("## Summary", "## Recommendation")],
  ["empty summary", review().replace("Reviewed the supplied changes.", "")],
  ["duplicate sections", review().replace("## Findings", "## Findings\n## Findings")],
  ["score out of range", review("No findings.", 101)],
  ["contradictory clean score", review("No findings.", 95)],
  ["missing score", review().replace("**Health Score:** 100/100", "")],
  ["malformed score", review().replace("100/100", "1.5/100")],
  ["duplicate score", review().replace("## Findings", "Health Score: 100/100\n## Findings")],
  ["findings outside validated section", review().replace("## Findings", `${FINDING}\n## Findings`)],
  ["findings hidden in summary", review().replace("Reviewed the supplied changes.", FINDING)],
]) {
  test(`rejects ${name} rather than declaring a clean review`, () => {
    assert.throws(() => validateReviewReport(report), /Invalid review report/);
  });
}

test("multiline fields are allowed without weakening required field checks", () => {
  const result = validateReviewReport(review(FINDING.replace("Remedy:", "The unit is not documented.\nRemedy:"), 95));
  assert.equal(result.findings.warning, 1);
});

for (const counts of [null, {}, [], { critical: 0 }, { ...ZERO, warning: "0" },
  { ...ZERO, critical: -1 }, { ...ZERO, suggestion: 0.5 }, { ...ZERO, warning: NaN }]) {
  test(`invalid finding counts fail closed: ${JSON.stringify(counts)}`, () => {
    assert.throws(() => assertFindingCounts(counts), /Invalid review report/);
  });
}

test("serialized counts and scores must agree with the validated text", () => {
  const result = { report: review(FINDING, 95), score: 95, findings: { ...ZERO, warning: 1 } };
  validateGateReport(result);
  assert.throws(() => validateGateReport({ ...result, findings: ZERO }), /disagree/);
  assert.throws(() => validateGateReport({ ...result, score: null }), /disagree/);
});

function runGate(payload, flags = []) {
  const dir = mkdtempSync(path.join(tmpdir(), "brooks-gate-"));
  try {
    const file = path.join(dir, "report.json");
    writeFileSync(file, typeof payload === "string" ? payload : JSON.stringify(payload));
    return spawnSync(process.execPath, ["scripts/ci-gate.mjs", "--report", file, ...flags], {
      cwd: root, encoding: "utf8", timeout: 10_000,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

for (const payload of [{}, { report: "", score: null, findings: ZERO }, "{broken JSON"] ) {
  test("gate CLI rejects invalid input even when severity gates are disabled", () => {
    const result = runGate(payload, ["--fail-on", "none"]);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /Review validation failed/);
    assert.doesNotMatch(result.stdout, /quality gates passed/);
  });
}

test("gate CLI preserves clean success and configured severity behavior", () => {
  const clean = { report: review(), score: 100, findings: ZERO, previousScore: null, delta: null };
  assert.equal(runGate(clean, ["--fail-on", "critical"]).status, 0);
  const warning = { ...clean, report: review(FINDING, 95), score: 95, findings: { ...ZERO, warning: 1 } };
  assert.equal(runGate(warning, ["--fail-on", "critical"]).status, 0);
  assert.equal(runGate(warning, ["--fail-on", "warning"]).status, 1);
  assert.equal(runGate(clean, ["--fail-on", "typo"]).status, 1);
});

function runReview(payload, extra = []) {
  // Exercise the real CLI/provider extraction with an in-process fetch stub:
  // no credentials, network, SDK installation, or paid model calls needed.
  const stub = `globalThis.fetch = async () => ({ ok: true, json: async () => (${JSON.stringify(payload)}) });`;
  return spawnSync(process.execPath, ["--import", `data:text/javascript,${encodeURIComponent(stub)}`,
    "scripts/ci-review.mjs", "--provider", "opencode", "--model", "test-model", ...extra], {
    cwd: root, encoding: "utf8", timeout: 10_000,
    env: { ...process.env, OPENCODE_API_KEY: "test-only-not-a-credential" },
  });
}

for (const content of ["", "  ", "The report was truncated", review(FINDING.replace(/Remedy:.+/, ""), 95)]) {
  test("review CLI rejects unusable provider text without emitting a clean JSON result", () => {
    const result = runReview({ choices: [{ message: { content }, finish_reason: "stop" }] });
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /Invalid review report/);
  });
}

test("review CLI rejects contentless and token-limited completions", () => {
  assert.equal(runReview({ choices: [] }).status, 1);
  const truncated = runReview({ choices: [{ message: { content: review() }, finish_reason: "length" }] });
  assert.equal(truncated.status, 1);
  assert.match(truncated.stderr, /did not complete/);
  assert.equal(runReview({ status: "incomplete", output_text: review() }, ["--api-protocol", "responses"]).status, 1);
});

test("both OpenCode protocols accept completed clean reviews", () => {
  for (const [payload, extra] of [
    [{ choices: [{ message: { content: review() }, finish_reason: "stop" }] }, []],
    [{ status: "completed", output_text: review() }, ["--api-protocol", "responses"]],
  ]) {
    const result = runReview(payload, extra);
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.score, 100);
    assert.deepEqual(parsed.findings, ZERO);
    assert.equal(runGate(parsed, ["--fail-on", "critical"]).status, 0);
  }
});

test("invalid reviews cannot emit an empty SARIF success", () => {
  const result = runReview({ choices: [] }, ["--format", "sarif"]);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
});

test("the CI contract works across all supported modes", () => {
  for (const mode of VALID_MODES) {
    const payload = { choices: [{ message: { content: review(FINDING, 95) }, finish_reason: "stop" }] };
    const result = runReview(payload, ["--mode", mode]);
    assert.equal(result.status, 0, `${mode}: ${result.stderr}`);
    assert.deepEqual(JSON.parse(result.stdout).findings, { ...ZERO, warning: 1 });
  }
});
