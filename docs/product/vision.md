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

