# Gongxu

Gongxu turns an existing repository into an evidence-backed AI engineering
system. An agent inspects the repository, asks only questions that cannot be
answered from the code, compiles a structured project blueprint, and generates
a minimal `.ai/` directory with thin adapters for supported coding agents.

The first product surface is the `bootstrap-ai-project` Agent Skill. Its flow
is deliberately split into two parts:

1. The agent reasons about repository evidence and conducts the adaptive
   interview.
2. Deterministic scripts inspect, compile, preserve ownership, and validate the
   generated artifacts.

The generated system follows three rules:

- Human-readable: project facts and boundaries are reviewable Markdown.
- Agent-discoverable: root instructions and repo-scoped skills use each
  agent's supported discovery locations.
- Machine-verifiable: structured files, provenance, commands, hashes, and
  validation gates prevent unsupported claims and silent overwrites.

This repository is under active development. The current milestone is a
verified brownfield initialization workflow for Codex and Claude Code.

## Use The Skill

Requirements:

- Node.js 22.12 or newer;
- a repository the agent can inspect locally;
- Codex or another Agent Skills-compatible host.

For local development, expose the skill through a supported skill location:

```bash
mkdir -p ~/.agents/skills
ln -s /absolute/path/to/gongxu/skills/bootstrap-ai-project \
  ~/.agents/skills/bootstrap-ai-project
```

Codex also supports installation from a hosted repository through
`$skill-installer`. Once the skill is discoverable, invoke it from the target
repository:

```text
$bootstrap-ai-project Analyze this repository, ask only consequential
questions, preview the blueprint, and initialize its AI engineering system.
```

The agent will run a read-only inspection first, distinguish repository facts
from assumptions, interview for consequential unknowns, preview the proposed
blueprint, and then compile and validate the generated system. It will not
adopt an existing unowned `.ai/` directory or overwrite managed drift without
an exact `--force-path` approved by the user.

## Generated Contract

`.ai/blueprint.json` is the canonical structured source. Generated Markdown,
verification files, and agent adapters are deterministic views:

```text
.ai/
  blueprint.json
  manifest.json
  project/
  architecture/
  rules/
  skills/
  workflows/
  verification/
AGENTS.md
CLAUDE.md                 # when Claude Code is selected
.agents/skills/           # Codex wrappers
.claude/skills/           # Claude Code wrappers
```

The current milestone does not implement chat memory, task leases, multi-agent
coordination, or a hosted control plane. Those are later consumers of the same
project blueprint, not part of repository initialization.

## Develop

```bash
npm test
npm run validate:skill
npm run inspect:self
```

The test suite exercises inspection, schema and semantic validation, first
compile, idempotence, adapter discovery, user-content preservation, managed
drift, exact-path overrides, obsolete artifact cleanup, and symlink safety.
