/** Strict CI boundary around the best-effort Markdown parser. */
import { countFindings } from "./report-parse.mjs";

const SEVERITIES = ["critical", "warning", "suggestion"];
const FIELDS = ["Symptom", "Source", "Consequence", "Remedy"];
const COMPLETE = "Review status: complete";

// CI needs an unambiguous result in every mode. Interactive reports and the
// frozen parser corpus keep their existing, more permissive formats.
export const CI_REPORT_INSTRUCTIONS = `
## CI output contract
This is a read-only CI review. Return a completed review, not a plan or a request
for confirmation. If you cannot complete the review, explain why and do not
write the completion line below.
Use exactly one Health Score: N/100 line (integer 0 through 100; use the composite
score in health mode). Markdown bold around this label is allowed.
Put all findings in exactly one "## Findings" section, followed by "## Summary".
Inside Findings, use only "### Critical", "### Warning", or "### Suggestion"
groups (severity emoji are allowed), then a **Risk Name — title** for each finding
and nonempty Symptom:, Source:, Consequence:, Remedy: fields in that order.
Field values may continue onto later lines. Do not use code fences, tables,
nested headings, or other finding formats inside this section.
If there are no findings, put exactly "No findings." in the Findings section.
Do not include empty severity groups. Other mode-specific material may appear
before Findings. Include a nonempty Summary and end the entire report with the
exact line "${COMPLETE}" only after the review is complete.
`;

function invalid(message) {
  throw new Error(`Invalid review report: ${message}. Rerun the review with the CI output contract.`);
}

/** Reject missing/partial/non-numeric counts instead of silently using zero. */
export function assertFindingCounts(counts) {
  if (!counts || typeof counts !== "object" || Array.isArray(counts) ||
      SEVERITIES.some((key) => !Number.isSafeInteger(counts[key]) || counts[key] < 0)) {
    invalid("findings must contain nonnegative integer critical, warning, and suggestion counts");
  }
}

/** Validate completeness and every finding block before computing gate inputs. */
export function validateReviewReport(report) {
  if (typeof report !== "string" || !report.trim()) invalid("empty or non-text response");
  const lines = report.trim().split(/\r?\n/);
  if (lines.at(-1).trim() !== COMPLETE) invalid("missing final completion line");
  const starts = lines.flatMap((line, i) => /^## Findings\s*$/.test(line) ? [i] : []);
  const ends = lines.flatMap((line, i) => /^## Summary\s*$/.test(line) ? [i] : []);
  if (starts.length !== 1 || ends.length !== 1 || starts[0] >= ends[0]) {
    invalid("expected one Findings section followed by one Summary section");
  }
  if (!lines.slice(ends[0] + 1, -1).join("\n").trim()) invalid("empty Summary");
  const scores = lines.map((line) => line.replace(/\*\*/g, "").trim())
    .filter((line) => /^Health Score\s*:/i.test(line));
  const scoreMatch = scores.length === 1 && scores[0].match(/^Health Score:\s*(\d{1,3})\s*\/\s*100$/i);
  if (!scoreMatch || Number(scoreMatch[1]) > 100) invalid("expected one integer Health Score from 0 to 100");
  const score = Number(scoreMatch[1]);
  const body = lines.slice(starts[0] + 1, ends[0]).join("\n").trim();
  const outside = [...lines.slice(0, starts[0]), ...lines.slice(ends[0] + 1)].join("\n");
  if (/^\s*(Symptom|Source|Consequence|Remedy):/m.test(outside)) invalid("finding fields outside Findings");
  if (body === "No findings.") {
    if (score !== 100) invalid("clean result must have a Health Score of 100");
    if (Object.values(countFindings(report)).some((count) => count !== 0)) invalid("clean result contradicts parsed findings");
    return { score, findings: { critical: 0, warning: 0, suggestion: 0 } };
  }
  if (!body || body.includes("No findings.")) invalid("missing or contradictory findings");

  const expected = { critical: 0, warning: 0, suggestion: 0 };
  let severity = null;
  let groupSize = 0;
  let current = null;
  const finishFinding = () => {
    if (!current) return;
    if (current.values.length !== FIELDS.length || current.values.some((value) => !value.trim())) {
      invalid("a finding is missing a nonempty Symptom, Source, Consequence, or Remedy");
    }
    expected[severity]++;
    groupSize++;
    current = null;
  };
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const group = line.match(/^###\s*(?:🔴|🟡|🟢)?\s*(Critical|Warning|Suggestion)\s*$/);
    if (group) {
      finishFinding();
      if (severity && groupSize === 0) invalid("empty severity group");
      severity = group[1].toLowerCase();
      groupSize = 0;
    } else if (/^\*\*[^*]+\*\*$/.test(line)) {
      if (!severity) invalid("finding title has no severity group");
      finishFinding();
      current = { values: [] };
    } else {
      if (!current || /^#|^\*\*|^```|^~~~|^\|/.test(line)) invalid("unrecognized finding format");
      const field = line.match(/^(Symptom|Source|Consequence|Remedy):\s*(.*)$/);
      if (field) {
        if (field[1] !== FIELDS[current.values.length]) invalid("missing, duplicate, or out-of-order finding field");
        current.values.push(field[2]);
      } else if (current.values.length) {
        current.values[current.values.length - 1] += `\n${line}`;
      } else {
        invalid("finding content precedes Symptom");
      }
    }
  }
  finishFinding();
  if (!severity || groupSize === 0) invalid("no complete findings or explicit clean result");
  // A grammar-valid block must also survive the parser used by SARIF. Never
  // hide a parser mismatch behind the model's score or a partial count.
  const findings = countFindings(report);
  if (SEVERITIES.some((key) => findings[key] !== expected[key])) invalid("not every finding was parsed");
  return { score, findings };
}

/** Revalidate serialized CLI output so malformed/legacy input cannot bypass CI. */
export function validateGateReport(report) {
  if (!report || typeof report !== "object" || Array.isArray(report)) invalid("expected a report object");
  const validated = validateReviewReport(report.report);
  assertFindingCounts(report.findings);
  if (report.score !== validated.score || SEVERITIES.some((key) => report.findings[key] !== validated.findings[key])) {
    invalid("serialized score or findings disagree with the review text");
  }
  return validated;
}
