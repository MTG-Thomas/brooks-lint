# Mempalace Protocol

Mempalace context is optional expert context. Use it only to strengthen or qualify findings.
Do not create a finding solely because a principle exists.

For each mempalace-supported finding:

1. Map the issue to an existing brooks-lint risk code.
2. Cite the relevant principle by ID.
3. Include concrete evidence from the reviewed artifact.
4. Check false-positive guards.
5. State the counterargument when relevant.
6. Prefer specific design remedies over generic advice.
7. Preserve brooks-lint's existing severity and report structure.

If the context packet is absent, stale, or irrelevant, ignore it and continue with normal brooks-lint behavior.

