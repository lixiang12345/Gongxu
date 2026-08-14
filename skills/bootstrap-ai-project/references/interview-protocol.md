# Adaptive Interview Protocol

## Contents

1. Objective
2. Evidence Before Questions
3. Question Eligibility
4. Priority Order
5. Question Shape
6. Stop Conditions
7. Default Handling
8. Brownfield Rules

## Objective

Turn consequential unknowns into confirmed project facts without forcing the
user through a generic questionnaire. The interview exists to resolve compiler
decisions, not to collect background for its own sake.

## Evidence Before Questions

Before asking anything, inspect:

- repository and package manifests;
- scripts, task runners, and lockfiles;
- top-level source, application, package, and service directories;
- tests and CI workflows;
- README, architecture docs, ADRs, API schemas, and deployment files;
- existing `AGENTS.md`, `CLAUDE.md`, agent rules, skills, and `.ai/` state;
- Git branch, revision, and dirty-state metadata.

Do not read `.env`, credential files, key stores, production dumps, or secret
values. File existence may be recorded without reading contents.

## Question Eligibility

Ask a question only when all conditions hold:

1. The answer is not safely derivable from evidence.
2. Different answers produce materially different generated output.
3. Guessing could encode a false fact, wrong boundary, invalid command, or
   inappropriate enforcement rule.
4. The question can be answered by the project owner without doing new research.

Do not ask:

- which language, framework, or package manager is used when manifests show it;
- what commands exist when scripts or CI show them;
- whether a visible module or directory exists;
- broad preference questions with no output consequence;
- questions whose only purpose is to make the generated documents longer.

## Priority Order

Resolve unknowns in this order:

1. Product purpose, primary users, and critical flows when absent from docs.
2. Initialization scope in monorepos or multi-product repositories.
3. Whether current architecture should be preserved, repaired, or migrated.
4. Non-negotiable boundaries, compatibility promises, and protected artifacts.
5. Security, privacy, compliance, availability, and deployment constraints.
6. Required verification gates and known external test dependencies.
7. Agent adapters the team actually uses.
8. Team ownership only when it affects rules or generated workflows.

Do not block initialization on speculative future scale or optional tooling.

## Question Shape

Ask one to three questions per round. Each question must include:

- `Evidence`: what the repository currently shows;
- `Decision`: the missing choice;
- `Impact`: which generated artifacts depend on it;
- `Recommendation`: an evidence-based default when available.

Example:

```text
Evidence: `apps/web` and `services/api` are both active, but no architecture
document defines whether they are independently deployable.

Decision: Should Gongxu model them as two deployable modules or one product
unit?

Impact: This changes module boundaries, release workflow, and verification
working directories.

Recommendation: Two deployable modules, because each has its own manifest and
CI job.
```

Prefer concrete choices plus a free-form answer. Avoid leading the user toward
technology not supported by evidence.

## Stop Conditions

Stop the interview when:

- product scope is clear enough to describe in two sentences;
- initialization scope is unambiguous;
- current and target architecture relationship is known;
- every blocking rule has confirmed or observed provenance;
- required verification commands are observed or explicitly confirmed;
- adapter selection is known;
- remaining unknowns can be recorded without changing safe initial output.

Target no more than eight material questions for a typical brownfield project.
If more are needed, the repository likely needs a staged initialization. Compile
the confirmed core and record the rest as open questions.

## Default Handling

When the user says to use defaults:

- preserve the current stack and architectural shape;
- generate warnings instead of new blocking boundaries;
- select only verification commands observed in manifests or CI;
- generate Codex and Claude adapters only when their files are detected, unless
  the user explicitly requests them;
- record every accepted default as a confirmed assumption with interview
  provenance.

Never turn a model preference into a project fact merely because defaults were
accepted.

## Brownfield Rules

- Describe current reality before proposing a target state.
- Do not rewrite existing architecture documentation to match an inference.
- When code and docs disagree, record the disagreement and ask only if it
  affects enforcement.
- Existing inconsistent patterns are not automatically examples to emulate.
- Select examples only after checking they are representative and maintained.
- Treat an existing command as available, not necessarily passing; execution is
  separate evidence.

