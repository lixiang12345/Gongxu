# Product Vision

Gongxu lets a user enter an existing repository and ask an AI agent to
initialize its engineering rules. The agent first builds an evidence inventory,
then interviews the user about only the consequential unknowns, and finally
compiles a project-specific `.ai/` system.

## Initial User Journey

1. The user invokes `bootstrap-ai-project` in a repository.
2. The skill runs a read-only repository inspector.
3. The agent classifies findings as observed, confirmed, inferred, or unknown.
4. The agent asks at most three focused questions at a time. Each question must
   change a concrete output decision.
5. The agent presents a concise blueprint summary before the first write.
6. The deterministic compiler generates `.ai/` and selected agent adapters.
7. The validator checks provenance, paths, rules, discovery, and verification.
8. The agent reports generated artifacts, assumptions, unresolved gaps, and
   exact validation evidence.

## Product Boundary

The first milestone is an engineering-system compiler, not a code generator,
chat-memory service, issue tracker, or agent scheduler. Context recovery and
multi-agent coordination remain later layers that consume the same project
blueprint.

## Success Criteria

- A brownfield repository can be initialized without inventing project facts.
- The interview does not ask for discoverable stack or command information.
- Generated rules are project-specific, actionable, and traceable to evidence.
- Codex and Claude Code can discover the generated root guidance and skills.
- Re-running the compiler is idempotent when inputs are unchanged.
- User edits outside managed regions survive regeneration.
- User edits inside managed files are detected before overwrite.
- A repository with invalid or incomplete output fails with actionable errors.

## Definition Of Complete

For this milestone, a release is complete only when all of the following are
true:

1. A single-project repository and an explicitly selected nested project in a
   monorepo can be inspected without writing first.
2. The adaptive interview asks only consequential questions, and the approved
   blueprint distinguishes observed, confirmed, inferred, and unknown facts.
3. A dry-run previews the generated contract before compilation, then produces
   `.ai/blueprint.json`, deterministic project views, verification files, and
   thin Codex and Claude Code adapters.
4. `npm test`, `npm run validate:skill`, and `npm run package:plugin` pass, and
   the smallest brownfield fixture completes inspect/compile/validate and a
   generated verification-runner check.
5. Recompilation is idempotent; user-owned content survives; managed drift,
   unsafe paths, and failed writes are rejected or rolled back as specified.

This milestone does not include chat memory, task leases, issue tracking,
multi-agent coordination, or a hosted control plane.
