# Existing Project Migration

## Contents

1. Ownership Model
2. Preflight
3. Existing `.ai`
4. Existing Instructions
5. Existing Skills
6. Drift
7. Safe Upgrade

## Ownership Model

Gongxu manages complete generated files under `.ai/` except:

- `.ai/blueprint.json`, which is the editable structured source;
- `.ai/architecture/decisions/`, which is human-owned;
- `.ai/memory/`, which is runtime and human-owned;
- any path explicitly marked `human` in the manifest.

For root `AGENTS.md` and `CLAUDE.md`, Gongxu owns only the content between its
managed markers. Agent skill wrappers generated under `.agents/skills` and
`.claude/skills` are fully managed.

## Preflight

Before an update:

1. Run the validator with `--allow-drift`.
2. Read `.ai/manifest.json` and `.ai/blueprint.json`.
3. Compare current managed hashes with the manifest.
4. Inspect existing user-authored instruction and skill files.
5. Classify changes as source edits, managed drift, or unrelated user content.

## Existing `.ai`

If `.ai/` exists without a Gongxu manifest, treat it as entirely user-owned.
Do not adopt or overwrite it automatically. Propose either:

- import into a new Gongxu blueprint and preserve existing paths;
- use a namespaced migration directory for review;
- stop and let the user choose another canonical location.

## Existing Instructions

Never replace an existing `AGENTS.md` or `CLAUDE.md`. Insert or update only the
bounded managed region. When existing rules conflict with the proposed
blueprint, surface the conflict before compilation.

## Existing Skills

Do not overwrite a non-Gongxu skill with the same name. Generated wrappers use
the `gongxu-` prefix. If that prefixed path already exists without a matching
manifest ownership record, stop and report the collision.

## Drift

Managed drift means a user or another tool changed content whose prior hash is
recorded by Gongxu. Drift is not automatically wrong. The compiler must stop
and report exact paths unless `--force-path <relative-path>` is explicitly
approved for each of those paths.

Do not solve drift by deleting the manifest, regenerating the entire directory,
or weakening ownership checks.

## Safe Upgrade

1. Copy `.ai/blueprint.json` to an immutable temporary baseline, then copy that
   baseline to a separate working candidate.
2. Merge new observed evidence and confirmed decisions into the candidate.
3. Preserve stable fact and rule IDs where semantics did not change.
4. Run compiler dry-run with the immutable baseline passed as
   `--expected-blueprint`, then review created, updated, unchanged, and
   conflicted paths.
5. Compile with the same baseline and without force when no drift exists. If
   the canonical blueprint changed, refresh the baseline and re-merge.
6. Validate structure and adapters.
7. Run project verification separately.
8. Report any human-owned paths that were intentionally untouched.
