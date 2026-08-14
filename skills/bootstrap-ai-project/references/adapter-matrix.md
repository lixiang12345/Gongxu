# Agent Adapter Matrix

## Canonical Principle

`.ai/blueprint.json` and generated `.ai/` views are the tool-neutral source of
truth. Agent-specific files only expose that source through locations the agent
actually discovers. Do not maintain independent copies of project policy.

## Codex

- Root guidance: `AGENTS.md`.
- Repository skills: `.agents/skills/<skill-name>/SKILL.md`.
- Root and nested `AGENTS.md` files are merged from repository root toward the
  current working directory.
- Repository skill wrappers should direct Codex to the canonical
  `.ai/skills/<skill-name>/SKILL.md`.

Official source: https://learn.chatgpt.com/docs/build-skills

## Claude Code

- Root guidance: `CLAUDE.md`.
- Use `@AGENTS.md` in `CLAUDE.md` to share the root contract.
- Repository skills: `.claude/skills/<skill-name>/SKILL.md`.
- Instruction files guide behavior but do not enforce it; use hooks,
  permissions, tests, or CI for hard constraints.

Official source: https://code.claude.com/docs/en/memory

## Adapter Rules

- Use bounded `gongxu` managed regions in existing root instruction files.
- Preserve all content outside those regions byte-for-byte.
- Generate small wrapper skills rather than duplicate canonical skill bodies.
- Prefix generated skill names with `gongxu-` to avoid collisions.
- Do not create an adapter for an agent the user did not select unless detected
  configuration and accepted defaults explicitly permit it.
- Record every adapter and managed path in `.ai/manifest.json`.
- Treat OpenCode, Cursor, Copilot, and other targets as unsupported until their
  current official discovery behavior is implemented and tested.

