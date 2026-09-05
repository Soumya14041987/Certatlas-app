---
slug: d2-context
domain: CMR
title: Context Engineering, CLAUDE.md & Memory
summary: The memory hierarchy, progressive disclosure, context budgeting and durable agent state.
---

## hierarchy

| Scope | Path | Shared? | Loaded |
|-------|------|---------|--------|
| Enterprise | managed policy location | Org-wide | Always |
| Project | `./CLAUDE.md` | Committed | Always |
| Directory | `services/payments/CLAUDE.md` | Committed | **On demand**, when work touches that subtree |
| User | `~/.claude/CLAUDE.md` | Private | Always, every project |

More specific scope wins a conflict. A repo's "use tabs" beats a personal "use spaces" — otherwise formatting would depend on who typed.

Directory-scoped memory is what makes monorepos work: the search team never pays for the payments team's rules.

## imports

`@path/to/file.md` inside a memory file. Nesting is supported to a **bounded depth**, so cycles cannot expand forever.

## progressive-disclosure

Keep the always-loaded file short and high-signal; point at depth.

```markdown
# Payments service

## Commands
- Test: `pnpm test` | Lint: `pnpm lint` | Types: `pnpm typecheck`

## Hard rules
- Money is `bigint` minor units. Never floats.
- Every handler goes through `withIdempotency()`.

## Deeper reading (loaded only when relevant)
- Ledger invariants: @docs/ledger.md
- PSP failover runbook: @docs/psp-failover.md
```

## what-belongs

**Yes:**
- Exact build / test / lint commands
- Invariants invisible in the code — "`orders` is append-only; never UPDATE"
- Conventions a newcomer would get wrong — "integration tests live beside the module"
- Verification procedure — "before reporting done, run `pnpm test` and paste the summary; if you didn't run it, say so"

**No:**
- Bulk reference documentation (-> a skill, or an on-demand doc)
- Fast-decaying facts (on-call rota, sprint numbers)
- "Write good, clean code" — zero decision content, pure context tax

Rule of thumb: if it isn't **specific, checkable and load-bearing**, it isn't earning its permanent place in every request.

## memory-vs-skill

| Need | Mechanism | Cost when idle |
|------|-----------|----------------|
| Always-true project facts | `CLAUDE.md` | Paid every turn |
| Large situational procedure | **Skill** | Name + description only |
| Independent work in a clean context | **Subagent** | Nothing |
| Deterministic enforcement | **Hook** | Nothing |

40-page incident runbook -> skill, not memory.

## capture

- `#` at the start of a message -> captured as memory; you choose the file.
- `/memory` -> open memory files for editing.
- Conversation is **not** persisted to memory automatically.

## budgeting

Consumes context: system prompt, loaded memory, **tool schemas for every enabled MCP server**, the whole transcript, every tool result.
Does not: files you never read.

Tactics:
1. Targeted retrieval — follow the stack trace, don't read 300 files.
2. Filter at the emitter — compact test reporters, `tail`, quiet flags. 40,000 lines of test output lands in context verbatim.
3. Scope MCP servers to the projects that need them; consolidate overlapping ones (ambiguous tools cause wrong picks).
4. Delegate high-ratio sweeps to subagents — parent pays for the summary, not the 400 file reads.

## compaction

| Situation | Action |
|-----------|--------|
| Same task, transcript too long | `/compact focus on the repro steps and ruled-out hypotheses` |
| New ticket / unrelated topic | `/clear` |
| Abandoned approach keeps resurfacing | `/clear` |
| One huge tool result | Filter the command, not the session |

Compact **deliberately**, at a moment you choose, naming what must survive — better than letting auto-compaction pick.

## agent-state

Context is **working memory, not the system of record.** Long loops must externalise progress:

```markdown
# TASKS.md — read at the start of every iteration
- [x] Extract PaymentValidator from OrderService
- [x] Add unit tests for PaymentValidator
- [ ] Migrate callers in services/checkout   <- next
```

Phase-driver pattern: each phase starts from a fresh context, reads the findings file, does one bounded job, appends. No compaction can lose the result.

## workflow

**Explore -> Plan -> Code -> Commit.** The expensive mistakes are made in the first two phases, and they are also the cheapest to correct — which is why plan mode puts a human gate between plan and code.

## maintenance

Memory is code. A `CLAUDE.md` that still says "Jest" four months after migrating to Vitest will be obeyed.

Governance that actually works: any PR changing build commands, test tooling or a documented invariant **updates `CLAUDE.md` in the same PR**, enforced by CODEOWNERS + a CI check. Quarterly audits find rot months late; locking the file guarantees it.

## monorepo

Root file = organisation-wide invariants and shared commands only. Per-service knowledge -> that service's directory, loaded on demand. One 2,000-line root file means everyone pays for everyone's rules on every turn.
