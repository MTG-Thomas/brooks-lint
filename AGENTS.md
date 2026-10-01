# brooks-lint

Portable code-quality skills grounded in twelve classic engineering books. Six skills under `skills/brooks-*` use shared rules in `skills/_shared/`; `scripts/` validates structure and report parsing, and `evals/` contains structural scenarios and the frozen benchmark. Plugin metadata and command wrappers serve different agent runtimes.

For skill structure, use [engineering standards](docs/agent-guidance.md#engineering-standards); for platform adapters, [compatibility gotchas](docs/claude-conventions.md#critical-gotchas); for evals, [eval suite](docs/claude-conventions.md#eval-suite) and [benchmark rules](docs/claude-conventions.md#parser-fidelity-benchmark); for releases, [release procedure](docs/claude-conventions.md#release-process). Load applicable sections only. Use the appropriate review/audit/debt/test/health/sweep skill when discussing code quality in this repository, applying project `.brooks-lint.yaml` first when present.

## Invariants

Diagnose risks before proposing remedies. Every finding follows **Symptom → Source → Consequence → Remedy**. Keep internal documentation/configuration English. Scores start at 100, floor at zero, using `strict`, `balanced` (default), or `legacy-friendly`, with weights owned by `skills/_shared/common.md`; do not duplicate or change weights in a wrapper.

Every skill description needs a `Do NOT trigger for:` boundary. Preserve `metadata.opencode/slash: "true"`. A skill's Process is a short skeleton referring to detailed guide step ranges; its item count need not match the guide's numbered steps. Keep step continuity and source-to-skill coverage consistent.

## Verification

From root run `npm run validate`, `npm test`, `npm run evals`, and `npm run benchmark`, matching the structural CI lane and package scripts. The eval suite contains 57 scenarios. These check repository structure, deterministic scenarios, and parser fidelity; they do not establish live model quality.

`npm run evals:live` calls an external model and needs `ANTHROPIC_API_KEY`; run it only within an explicitly scoped live evaluation, without emitting the key. Version bump, changelog, and installation scripts can change distribution metadata or host configuration; inspect their scope before use. Preserve upstream skill/plugin compatibility when applying MTG-specific changes to this fork.

Use feature branches and reviewed PRs for MTG changes; no direct-to-main or assumed global plugin/harness prerequisite. Preserve frozen benchmark ground truth, derived platform/book inventories, deliberate validator exceptions, VS Code exclusion, and complete commit-range release audits.
