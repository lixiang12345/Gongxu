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

The release contract for this milestone is documented in
[`docs/product/vision.md`](docs/product/vision.md#definition-of-complete).

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

Codex also supports installation from another repository through
[`$skill-installer`](https://learn.chatgpt.com/docs/build-skills). Ask it to
install this repository's skill directory:

```text
$skill-installer Install bootstrap-ai-project from
https://github.com/lixiang12345/Gongxu/tree/main/skills/bootstrap-ai-project
```

Codex detects newly installed skills automatically; restart Codex if it does
not appear. Once the skill is discoverable, invoke it from the target
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

### What a Run Feels Like

The normal path is one skill invocation plus a few consequential answers:

1. Gongxu scans the target repository without writing.
2. The agent asks only questions that change the generated project contract.
3. You review the blueprint summary and approve the first write.
4. Gongxu generates `.ai/`, adapters, and a verification runner.
5. Validation and the repository's exact checks run before completion is claimed.

Initial setup is moderate because the repository's real boundaries must be
confirmed. Repeat runs are shorter; they are usually a recompile and validation
pass, unless managed drift or a changed blueprint needs an explicit decision.

For repositories that are not currently inside an Agent Skills host, the
repository also includes a small standalone bootstrap command:

```bash
npm run bootstrap -- --root /absolute/path/to/target
```

It asks for the project purpose, primary users, and optional domain, uses only
verification commands observed in the target's CI, previews the blueprint, and
waits for approval before writing. Use `--yes` for accepted defaults or
`--dry-run` to preview without changing the target. Existing Gongxu state is
intentionally left to the richer Agent Skill update flow.

## Build The Plugin

Create a distributable Codex Plugin without duplicating the canonical Skill in
source control:

```bash
npm run package:plugin
```

The command assembles `dist/gongxu/` with `.codex-plugin/plugin.json` and a
copy of `skills/bootstrap-ai-project/`. An unchanged package is idempotent; a
drifted output is preserved unless the command is rerun with `--force`.

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
