# Gongxu

Gongxu compiles an existing repository's evidence and confirmed intent into a
small, reviewable AI engineering system.

## Project Model

**Evidence ledger**:
A record that separates what the repository shows, what the owner confirms,
what remains inferred, and what is still unknown.
_Avoid_: Guess, project lore

**Blueprint**:
The canonical structured description of a project's purpose, architecture,
rules, workflows, examples, verification, and selected adapters.
_Avoid_: Generated Markdown, agent prompt

**AI engineering system**:
The repository-scoped guidance, reusable workflows, and executable checks that
help an agent work safely within one project.
_Avoid_: Chat memory, task tracker, agent runtime

## Compilation

**Compiler**:
The deterministic part of Gongxu that turns an approved blueprint into
generated project artifacts and refuses unsafe ownership or provenance changes.
_Avoid_: Code generator, prompt builder

**Adapter**:
A thin discovery entry point for a supported agent; it points into the
canonical `.ai/` system and does not own project facts.
_Avoid_: Separate ruleset, source of truth

**Managed artifact**:
A generated file or bounded generated region whose ownership and hash are
recorded in `.ai/manifest.json`.
_Avoid_: Any file under `.ai/`

**Human-owned artifact**:
A file or region Gongxu preserves and never overwrites implicitly, including
the canonical blueprint, decisions, and memory.
_Avoid_: Unmanaged output

**Verification gate**:
An exact, repository-backed command whose result is required before Gongxu or
the generated project may claim completion.
_Avoid_: Suggested command, best practice
