# Gongxu Output Contract

## Contents

1. Canonical Source
2. Generated Tree
3. Blueprint Contract
4. Fact Contract
5. Architecture Contract
6. Rule Contract
7. Skill And Workflow Contract
8. Verification Contract
9. Ownership Contract
10. Minimality Rules

## Canonical Source

The interview produces one structured source file:

```text
.ai/blueprint.json
```

It must validate against `assets/blueprint.schema.json`. All other managed
artifacts are deterministic views of this blueprint. Do not manually create a
different schema or treat generated Markdown as an independent source.
The compiler and project validator execute the packaged Schema before applying
repository-aware semantic and provenance checks.

## Generated Tree

```text
<repo>/
├── AGENTS.md                         # bounded Gongxu region
├── CLAUDE.md                         # optional bounded region
├── .ai/
│   ├── blueprint.json                # editable structured source
│   ├── manifest.json                 # version, adapters, ownership hashes
│   ├── project/
│   │   ├── profile.md
│   │   ├── facts.json
│   │   └── repo-map.md
│   ├── architecture/
│   │   ├── current.md
│   │   ├── model.json
│   │   ├── boundaries.md
│   │   └── decisions/                # human-owned, preserved
│   ├── rules/
│   │   ├── catalog.json
│   │   └── <scope>.md
│   ├── skills/
│   │   └── <skill-id>/SKILL.md
│   ├── workflows/
│   │   └── <workflow-id>.md
│   ├── examples/                      # only when examples are selected
│   │   └── catalog.json
│   ├── verification/
│   │   ├── checks.json
│   │   └── run.mjs
│   └── memory/                       # human/runtime-owned, preserved
├── .agents/skills/                   # optional Codex wrappers
└── .claude/skills/                   # optional Claude wrappers
```

Do not generate empty category files. The required base is blueprint, manifest,
project views, architecture views, rule catalog, at least one workflow, and
verification files. Skills may be empty only when the user explicitly requests
rules without reusable workflows.

## Blueprint Contract

Top-level fields:

- `schemaVersion`: integer `1`.
- `project`: identity, summary, stage, kind, users, domains, and constraints.
- `evidence`: source revision, facts, unknowns, answers, and assumptions.
- `architecture`: observed current state, desired target state, and boundaries.
- `rules`: selected project-specific rules.
- `skills`: reusable project task workflows.
- `workflows`: lifecycle orchestration.
- `examples`: pointers to representative repository implementations.
- `verification`: observed or confirmed executable checks.
- `adapters`: selected agent adapters.

Use stable lowercase hyphen IDs. Preserve IDs across updates when semantics stay
the same.

`evidence.sourceRevision` records the exact Git HEAD inspected to build the
ledger, or `null` when no revision is available. A later HEAD mismatch is an
evidence-freshness warning rather than a hard error because the blueprint's own
commit necessarily advances the repository.
An initialized Git repository without a first commit has no HEAD, so its source
revision remains `null`; staged and untracked target files must still be
reported as working-tree evidence not captured by a revision.

Uncommitted repository changes also produce a freshness warning because HEAD
does not identify their contents. Gongxu-generated files, managed adapter
regions, `.ai/blueprint.json`, and `.ai/manifest.json` are excluded from that
warning; changes outside the markers in an adapter file, human-owned decisions,
memory, and other project files are not.

## Fact Contract

Each fact contains:

- `id`: stable identifier.
- `subject`: human-readable subject.
- `value`: structured JSON value.
- `status`: `observed`, `confirmed`, `inferred`, or `unknown`.
- `confidence`: number from 0 to 1.
- `evidence`: one or more evidence records for observed or confirmed facts.

Evidence records use:

- `kind`: `file`, `command`, `interview`, or `existing-config`.
- `path`: repository-relative path when applicable.
- `pointer`: JSON key, line label, or script name; required for command and
  interview evidence.
- `note`: concise explanation.

An observed fact must point to a real repository path or recorded command. A
command evidence pointer contains the exact observed command. An interview
evidence pointer references an entry in `evidence.answers`; confirmed facts
must cite one of those answers or an existing configuration.

## Architecture Contract

Represent both:

- `current`: evidence-backed reality in the repository.
- `target`: `preserve-current`, `confirmed`, or `proposed` desired state.

Each module has an ID, name, responsibilities, dependencies, and repository
paths. Do not assign a path that does not exist unless the target state is
confirmed and the module is marked planned. Current modules are never planned.
When the target status is `preserve-current`, its style and modules must match
the current architecture; its summary may explain the preservation decision.

Boundaries define `allow`, `deny`, or `approval` relationships. Warning and
blocking boundaries must cite observed or confirmed facts.

## Rule Contract

Each rule contains:

- stable ID and scope;
- concrete statement and rationale;
- severity `guide`, `warn`, or `block`;
- source fact IDs;
- optional verification check ID;
- optional approval requirement.

Every blocking rule requires a check ID or `approvalRequired: true`. Without an
approval alternative, its check must be marked required so a failure blocks the
generated verification runner.

## Skill And Workflow Contract

A skill contains project-specific triggers, required context paths, ordered
steps, and verification check IDs. It must not teach generic framework usage.
An `.ai/` context path must either be generated by the current blueprint or
already exist without being a stale managed artifact that compilation removes.
Its ID is lowercase hyphen-case and at most 57 characters so the generated
`gongxu-` adapter name remains within the 64-character Agent Skills limit.
Every generated `SKILL.md` name must match its containing directory, its
description must be non-empty, at most 1024 characters, and contain no angle
brackets, and the complete document must not exceed 500 lines. Compilation
must reject a blueprint before writing when its generated Skill metadata or
document would violate these limits.

A workflow coordinates phases such as inspect, design, implement, verify, and
review. Each required workflow step must have an observable action. Use a
check ID when a step is satisfied by deterministic verification. A check bound
to a required step must also be marked required.

## Verification Contract

Each verification check contains:

- stable ID and display name;
- exact command and repository-relative working directory;
- whether failure blocks completion;
- provenance pointing to a manifest, CI workflow, task runner, or confirmed
  interview answer.

Do not invent commands. A command's presence is different from a passing run;
the generated runner records execution status separately.

For `file` and `existing-config` provenance, `source.pointer` is required and
must resolve to the exact command. Use `line:<1-based-line-number>` for a
command-bearing line, a dotted key such as `scripts.test` for JSON, or an RFC
6901 JSON Pointer such as `/scripts/test`. A package script value proves its
script body, not a package-manager invocation assembled from other signals.
In GitHub Actions, an inline `run` value or the sole non-comment line of a
supported `run` block can back a check. A line selected from a multi-command
block cannot back an independent verification command.
For `interview` provenance, `source.path` references an `evidence.answers` entry
whose trimmed answer is exactly the confirmed command.

Commands must be single-line, contain no NUL bytes, and use existing working
directories.

## Ownership Contract

`.ai/manifest.json` records each managed artifact's SHA-256 hash and ownership
mode:

- `file`: Gongxu owns the entire file.
- `region`: Gongxu owns only its bounded marker region.
- `human`: Gongxu must not write the path.

The manifest may claim only paths produced by the current Gongxu renderer.
Arbitrary repository files, `.ai/blueprint.json`,
`.ai/architecture/decisions/`, and `.ai/memory/` are never valid managed-file
claims, even when a manifest entry contains their current hash.

The compiler must stop on drift in a managed file or region.
`--force-path <relative-path>` is an exact-path override, never an automatic or
directory-wide repair strategy.
Because `.ai/blueprint.json` is human-owned, an external candidate may replace
it only when `--expected-blueprint` contains the exact canonical bytes used as
that candidate's baseline. A stale or missing baseline is a source conflict,
not managed drift, and `--force-path` must not bypass it.
An existing full-file target without a matching manifest ownership record is a
collision even when its bytes equal the current renderer output. Byte equality
does not prove ownership; adopting that exact path requires `--force-path`.

If applying any managed write fails, the compiler must restore the file
contents and modes captured before that compile attempt, keep the prior
manifest, and report any rollback failure explicitly.

## Minimality Rules

- Keep root managed instructions below 120 lines.
- Generate no empty rule scope, skill, workflow, or example category.
- Point to representative existing code instead of copying it.
- Do not duplicate README or architecture prose already present; cite paths.
- Keep the default skill set to the smallest workflows supported by evidence.
- Record unresolved facts as unknowns instead of generating placeholder text.
