import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/** Canonical list of valid mode names — import from here to avoid drift. */
export const VALID_MODES = ["review", "audit", "debt", "test", "health"];

/**
 * Assemble the system prompt for a given brooks-lint mode.
 * Shared by: GitHub Action (ci-review.mjs) and Eval Runner (run-evals-live.mjs).
 *
 * @param {string} mode - one of VALID_MODES
 * @param {string} skillsDir - absolute path to skills/ directory
 * @param {string|null} projectDir - optional reviewed project root for .brooks-lint.yaml
 * @returns {string} concatenated system prompt with --- separators
 */
export function assembleSystemPrompt(mode, skillsDir, projectDir = null) {
  const sharedDir = path.join(skillsDir, "_shared");

  const read = (filePath) => readFileSync(filePath, "utf8");

  const sections = [
    read(path.join(sharedDir, "common.md")),
    read(path.join(sharedDir, "source-coverage.md")),
  ];

  // Add risk definitions based on mode
  if (mode === "test") {
    sections.push(read(path.join(sharedDir, "test-decay-risks.md")));
  } else if (mode === "health") {
    sections.push(read(path.join(sharedDir, "decay-risks.md")));
    sections.push(read(path.join(sharedDir, "test-decay-risks.md")));
  } else {
    sections.push(read(path.join(sharedDir, "decay-risks.md")));
  }

  // Add mode-specific guide
  const guideMap = {
    review: ["brooks-review", "pr-review-guide.md"],
    audit: ["brooks-audit", "architecture-guide.md"],
    debt: ["brooks-debt", "debt-guide.md"],
    test: ["brooks-test", "test-guide.md"],
    health: ["brooks-health", "health-guide.md"],
  };

  const [modeDir, guideFile] = guideMap[mode] ?? (() => { throw new Error(`Unknown mode: ${mode}`); })();
  sections.push(read(path.join(skillsDir, modeDir, guideFile)));

  const mempalaceSections = resolveMempalaceSections(skillsDir, projectDir);
  sections.push(...mempalaceSections);

  return sections.join("\n\n---\n\n");
}

function resolveMempalaceSections(skillsDir, projectDir) {
  const sharedDir = path.join(skillsDir, "_shared");
  const protocolPath = path.join(sharedDir, "mempalace-protocol.md");
  const config = projectDir ? readMempalaceConfig(path.join(projectDir, ".brooks-lint.yaml")) : { enabled: false };
  const contextPath = resolvePacketPath(skillsDir, projectDir, config.packet);

  if (!config.enabled || !existsSync(protocolPath)) {
    return [];
  }

  const sections = [readFileSync(protocolPath, "utf8")];
  if (contextPath && existsSync(contextPath)) {
    sections.push(readFileSync(contextPath, "utf8"));
  } else {
    sections.push("# Mempalace Context Packet\n\nNo generated mempalace context packet was found. Continue with normal brooks-lint behavior.");
  }
  return sections;
}

function resolvePacketPath(skillsDir, projectDir, packetPath) {
  const defaultPath = path.join(skillsDir, "_shared", "mempalace-context.md");
  if (!packetPath) return defaultPath;
  if (path.isAbsolute(packetPath)) return packetPath;
  return path.resolve(projectDir ?? path.dirname(skillsDir), packetPath);
}

function readMempalaceConfig(configPath) {
  const config = { enabled: false, packet: null };
  if (!existsSync(configPath)) return config;

  const text = readFileSync(configPath, "utf8");
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex(line => line.trim() === "mempalace:");
  if (start === -1) return config;

  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line) && line.includes(":")) break;
    if (/^\s+enabled:\s+true\s*$/.test(line)) config.enabled = true;
    if (/^\s+enabled:\s+false\s*$/.test(line)) config.enabled = false;
    const packetMatch = line.match(/^\s+packet:\s+(.+?)\s*$/);
    if (packetMatch) config.packet = packetMatch[1].replace(/^["']|["']$/g, "");
  }
  return config;
}
