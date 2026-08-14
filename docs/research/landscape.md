# Research Baseline

Research was performed on 2026-08-14 against current official documentation
and public repositories.

## Official Agent Behavior

- Codex reads hierarchical `AGENTS.md` files and discovers repository skills
  from `.agents/skills` between the current directory and repository root.
- Codex and the desktop app support repo-scoped MCP configuration, but static
  repository guidance is loaded at session start and is not runtime state.
- Claude Code reads `CLAUDE.md`, not `AGENTS.md`; its official guidance
  recommends importing `AGENTS.md` from `CLAUDE.md` when both agents are used.
- Claude treats instruction files as context, not enforcement. Hard constraints
  belong in hooks, permissions, tests, or other deterministic checks.

Sources:

- https://learn.chatgpt.com/docs/agent-configuration/agents-md
- https://learn.chatgpt.com/docs/build-skills
- https://learn.chatgpt.com/docs/extend/mcp?surface=cli
- https://code.claude.com/docs/en/memory

## Adjacent Projects

- `gastownhall/beads`: persistent task graph, memories, atomic claims, and Dolt
  synchronization. Gongxu should integrate rather than recreate its task graph.
- `Dicklesworthstone/mcp_agent_mail`: cross-agent identities, messaging, and
  advisory file or virtual-resource reservations.
- `Fission-AI/OpenSpec` and `github/spec-kit`: spec-driven change artifacts and
  agent workflows. These can become optional sources for project facts.
- `dyoshikawa/rulesync`: cross-agent rule, skill, MCP, hook, and permission
  conversion. It demonstrates why adapter compilation is a separate concern.
- `IgniteUI/ai-repo-structure`: a small, concrete separation of root guidance,
  agent-specific internals, portable skills, and deterministic validation.

## Resulting Decision

Gongxu's differentiator is not another generic rule library. It is the
evidence-backed compilation step that converts a real repository plus confirmed
intent into a minimal project world model, traceable rules, discoverable skills,
and executable verification without duplicating mature task or spec systems.

