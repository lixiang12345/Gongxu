# Keep runtime coordination out of bootstrap

The first milestone initializes existing repositories only. Chat memory, task
leases, issue tracking, multi-agent coordination, and a hosted control plane are
later consumers of the blueprint, not part of the bootstrap compiler. Keeping
these boundaries explicit avoids coupling initialization to a runtime that has
different ownership and availability concerns.
