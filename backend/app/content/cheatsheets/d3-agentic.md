---
slug: d3-agentic
domain: AAO
title: Agentic Workflows — Subagents, Skills, Plan Mode & Hooks
summary: The four extension primitives, when each one is the right answer, and how hooks enforce what instructions only request.
---

## capability-selection

The single most-tested judgement in this domain. Match the **trigger**, not the topic.

| Trigger shape | Mechanism |
|---------------|-----------|
| "Always true for this repo" | `CLAUDE.md` |
| "When the task is about X" (semantic) | **Skill** |
| "Do this independently, in a clean context" | **Subagent** |
| "Whenever tool/event Y happens" (mechanical) | **Hook** |
| "Distribute all of the above to 90 repos" | **Plugin** |

If the requirement contains *always*, *never* or *must* attached to an auditable action -> hook. If it is a judgement call ("prefer composition over inheritance") -> memory.

## subagents

`.claude/agents/<name>.md` (project) or `~/.claude/agents/<name>.md` (personal).

```markdown
---
name: security-reviewer
description: Reviews a diff for injection, authz gaps, secret leakage and unsafe
  deserialisation. Use after any change to auth, input handling or external calls.
tools: Read, Grep, Glob, Bash(git diff:*)
model: opus
---

You are a security reviewer. Read only the diff and the files it touches.
Report findings as: severity, file:line, the concrete exploit path, the fix.
Do not report style issues. Do not modify files.
```

| Field | Behaviour |
|-------|-----------|
| `description` | **The routing signal.** Vague description = never selected |
| `tools` | Omitted = **inherits** the parent's tools. Listed = restricted to exactly those |
| `model` | Per-agent tier — cheap model for sweeps, capable model for judgement |

**Isolation is the point.** The child has its own context window; the parent pays for the task description and the returned summary only. The child knows **nothing** of the parent conversation — so an under-specified task description is the number-one failure mode.

Use when: examined-material ÷ returned-conclusion is a large ratio (400-file sweeps, log reduction, independent review).
Don't use when: the parent genuinely needs the detail (a tight interactive refactor).

**Give every fan-out a return contract**, or you get five unmergeable essays:

```markdown
## Output format (strict)
Return ONLY a JSON array, one object per finding:
[{"severity":"blocking|advisory","file":"…","line":142,"finding":"…","fix":"…"}]
Return [] if you find nothing. Never return prose.
```

## skills

`.claude/skills/<name>/SKILL.md`. Only `name` and `description` are required.

**Three-tier disclosure:**
1. Frontmatter (name + description) — always in context
2. `SKILL.md` body — loaded when the skill activates
3. Bundled `reference/*.md`, `scripts/*.py`, templates — read/executed only when needed (a script's source may never enter context at all)

```markdown
---
name: incident-response
description: Use when handling a production incident — triage, severity
  classification, comms, postmortem. Trigger on "incident", "outage", "sev1", "pager".
allowed-tools: Read, Grep, Bash(kubectl get:*)
---
```

- The description carries **the entire activation decision**. "Database helper" never fires; naming trigger phrases does.
- Prefer a **bundled script** over prose for deterministic work — validating 5,000 CSV rows in context is slow, costly and probabilistic; running a validator returns twelve failures.
- `allowed-tools` in frontmatter enforces a restriction rather than requesting it.

## skills-vs-subagents

| | Skill | Subagent |
|---|-------|----------|
| Context | Injects into the **current** agent | Runs in a **separate** context |
| Use for | A procedure the main agent should follow itself | Independent work / review |
| Analogy | A checklist you follow | A reviewer who wasn't in your design meetings |

## hooks

Configured in `settings.json` under `hooks` (same precedence chain), editable via `/hooks`. Input arrives as **JSON on stdin**.

| Event | Fires | Can block? |
|-------|-------|-----------|
| `UserPromptSubmit` | Before the model sees a prompt | Yes — redact / reject / add context |
| `PreToolUse` | Before a tool runs | **Yes** |
| `PostToolUse` | After a tool runs | No (format, lint, audit) |
| `Stop` | Agent about to finish responding | **Yes** — definition-of-done gate |
| `SubagentStop` | A subagent finished | **Yes** — validate its contract |
| `PreCompact` | Before compaction | Persist state / steer the summary |
| `SessionStart` | Session begins or resumes | Inject dynamic context |
| `SessionEnd` | Session ends | Cleanup, export |

**Exit codes (heavily tested):**

| Code | Meaning |
|------|---------|
| `0` | Allow / success |
| `2` | **Block**, and stderr is fed back to the model so it can correct course |
| other non-zero | Non-blocking error shown to the user; the call proceeds |

```bash
#!/usr/bin/env bash
input=$(cat)
path=$(echo "$input" | jq -r '.tool_input.file_path // empty')
case "$path" in
  */config/production/*)
    echo "Blocked: production config is change-managed. Open a CR instead." >&2
    exit 2 ;;
esac
exit 0
```

`matcher` is a pattern over **tool names** (`Bash`, `Edit|Write`, `mcp__github__.*`), not files or users.

**Hooks vs permission rules:** rules are static pattern matches (flat always/never). Hooks are arbitrary code with the full payload — conditional logic ("allow the push only from a feature branch") and side effects (audit records).

**Keep them fast.** Hooks sit in the critical path of the turn; a 90-second linter is 90 seconds of the user waiting. Slow checks belong in CI.

**Security:** a committed hook is a shell command executed on the developer's machine with their credentials. Cloning an untrusted repo and starting Claude Code in it is the same trust decision as running its `postinstall` script.

## plan-mode

Read-only permission mode. Agent investigates and proposes; nothing mutates until a human approves. Rejection is a normal, cheap iteration — you're arguing about a design before code exists.

In CI, "analyse but never mutate" = `--permission-mode plan` **plus** a read-only tool allow-list. Make it structurally impossible rather than possible-but-reverted.

## orchestration

Fan-out/reduce is the workhorse pattern: partition -> parallel subagents -> parent synthesises.

- Cost scales roughly linearly with agent count. Worth it when concerns are genuinely independent and each returns little.
- Eight reviewers reading the same diff and reporting the same findings = 8x the bill for one review.
- **Bound the loops.** Cap attempts per subtask; on exhaustion, stop and escalate with what was tried and observed. 30 near-identical retries means a wrong hypothesis, not insufficient persistence.
- Debug a misbehaving subagent by inspecting **what it actually received** before changing the model or adding emphasis.

## verification

Red -> green -> refactor, with the "confirm it fails first" step intact. A test observed failing before and passing after is external, mechanical evidence. Self-review and stated confidence are the agent grading its own homework.

## human-in-the-loop

Gate where **reversibility is low and cost is high** — the plan stage and the merge. Per-edit approval trains people to click through (approval fatigue is worse than no gate); post-merge review is too late.

## plugins

The packaging and distribution unit for everything above. One versioned bundle of skills, subagents, slash commands and hooks, installed from a marketplace the organisation controls, updated centrally.

Copying `.claude/` into 90 repositories produces 90 divergent forks within a quarter. Plugins are the internal package registry to that copy-paste vendoring.
