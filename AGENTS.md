# Gongxu Repository Instructions

## Purpose

Build an evidence-first compiler that initializes and evolves a repository's
AI engineering system. The primary output is `.ai/`; agent-specific files are
generated adapters, not independent sources of truth.

## Product Invariants

- Never treat an inference as an observed repository fact.
- Never ask a question that a safe read-only scan can answer.
- Never generate generic best-practice rules without a project-specific reason.
- Never invent verification commands, architecture, or business requirements.
- Never overwrite user-modified managed files without an explicit force path.
- Keep canonical project knowledge tool-neutral; keep agent adapters thin.
- A successful compile is not complete until deterministic validation passes.

## Development Workflow

- Keep the reusable workflow in `skills/bootstrap-ai-project/`.
- Use Node.js built-ins for portable deterministic scripts where practical.
- Add fixtures and tests for every compiler or ownership behavior change.
- Run `npm test` and the skill validator before claiming completion.
- Inspect the final diff and leave unrelated changes untouched.

## Boundaries

- The first milestone initializes existing repositories. Do not pull the later
  multi-agent coordination runtime into the bootstrap compiler.
- `.ai/blueprint.json` is the structured source; generated Markdown is a view.
- `.ai/architecture/decisions/` and `.ai/memory/` are human/runtime-owned and
  must not be removed by regeneration.
