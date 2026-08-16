# Use an evidence-backed blueprint compiler

Gongxu's first milestone is a deterministic compiler for an evidence ledger and
confirmed intent, rather than a generic rules library or a code generator. This
keeps generated guidance project-specific and makes every blocking rule
traceable to repository evidence or an explicit owner decision.

**Consequences:** `.ai/blueprint.json` is the canonical source; generated
Markdown and agent adapters are views, and unsupported facts remain unknown
instead of becoming policy.
