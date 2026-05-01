# Mempalace Integration Prototype

This integration keeps brooks-lint as the critique frontend and treats local
MemPalace as the expert-context substrate.

## Boundaries

- `C:\Users\ThomasBray\.mempalace` owns book-derived principles, cross-book relationships, diagnostics,
  smells, examples, counterexamples, false-positive guards, validation, retrieval,
  and export.
- brooks-lint owns artifact analysis, risk classification, severity, remedy
  structure, report modes, CI/CLI integration, and final critique output.
- OneDrive Knowledge may provide curated markdown references and receive exported
  reference notes, but it is not used for scripts, caches, indexes, or runtime files.

## Minimal Flow

1. Edit structured context under `C:\Users\ThomasBray\.mempalace\brooks-lint\data`.
2. Validate the graph:

   ```powershell
   C:\Users\ThomasBray\.mempalace\bin\mempalace.ps1 validate-brooks-context
   ```

3. Export the compact packet consumed by brooks-lint:

   ```powershell
   C:\Users\ThomasBray\.mempalace\bin\mempalace.ps1 export brooks-context `
     --repo C:\Users\ThomasBray\src\hyhmrright\brooks-lint `
     --lenses brooks philosophy-of-software-design `
     --max-principles 8
   ```

   Optional curated Knowledge notes can be read as retrieval hints, and a
   reference note can be exported back to OneDrive:

   ```powershell
   C:\Users\ThomasBray\.mempalace\bin\mempalace.ps1 export brooks-context `
     --repo C:\Users\ThomasBray\src\hyhmrright\brooks-lint `
     --knowledge-note "C:\Users\ThomasBray\OneDrive - Midtown Technology Group LLC\Knowledge\pages\topic.software-design.md" `
     --knowledge-reference-out "C:\Users\ThomasBray\OneDrive - Midtown Technology Group LLC\Knowledge\pages\reference.brooks-lint-mempalace.md"
   ```

4. Enable the packet in the reviewed project's `.brooks-lint.yaml`:

   ```yaml
   mempalace:
     enabled: true
     packet: skills/_shared/mempalace-context.md
     lenses:
       - brooks
       - philosophy-of-software-design
     retrieval:
       max_principles: 8
       include_counterexamples: true
       include_tensions: true
   ```

`scripts/assemble-prompt.mjs` appends `skills/_shared/mempalace-protocol.md` and
`skills/_shared/mempalace-context.md` only when mempalace is enabled for a
reviewed project. The packet is generated and gitignored by default. If the
packet is missing, brooks-lint keeps the protocol guidance and continues with
normal review behavior.

## Sample Enriched Finding

### Finding: Shallow module boundary

Risk: R4 Accidental Complexity
Mempalace principle: apsd.deep-modules
Evidence: The public API exposes retry policy, serialization branching, and lifecycle sequencing to callers.
Why it matters: This appears to delegate complexity to callers rather than hiding design decisions behind a deeper module boundary.
False-positive guard checked: Thin wrappers may be acceptable when used as anti-corruption seams or test boundaries.
Recommendation: Collapse the public surface into a smaller operation-oriented API and move policy decisions behind the module boundary.
Confidence: Medium

## Risks and Limits

- The YAML corpus is intentionally paraphrased and compact; it is not a book ingest.
- Retrieval is hybrid lexical/semantic ranking over curated records, not a full
  vector database integration.
- Refresh is manual in v1; brooks-lint does not run MemPalace automatically.
- The generated Markdown packet is the only brooks-lint runtime dependency.

## Next Steps

- Add changed-file and diff-summary signals to the manual export command.
- Add curated Knowledge import/export commands once note shapes stabilize.
- Replace the lightweight semantic ranker with the canonical MemPalace retrieval
  backend if the parallel MemPalace improvement thread exposes one.
