---
slug: d1-fundamentals
domain: CCW
title: Claude Code Fundamentals & CLI Operations
summary: Sessions, settings precedence, permission modes, slash commands and the enterprise surface area.
---

## settings-precedence

Resolution runs **highest wins**:

| # | Source | Path | Who owns it |
|---|--------|------|-------------|
| 1 | Enterprise managed policy | macOS `/Library/Application Support/ClaudeCode/managed-settings.json` · Linux `/etc/claude-code/managed-settings.json` | Platform / security |
| 2 | Command-line arguments | `--allowedTools`, `--permission-mode`, … | The invoker |
| 3 | Local project settings | `.claude/settings.local.json` (git-ignored) | One developer |
| 4 | Shared project settings | `.claude/settings.json` (committed) | The team |
| 5 | User settings | `~/.claude/settings.json` | One developer, all projects |

> **Exam trap.** A CLI flag beats project settings — but *never* beats managed policy. Managed policy is the Service Control Policy of Claude Code.

## permission-modes

| Mode | File edits | Bash & other tools | Use it for |
|------|-----------|--------------------|------------|
| `default` | prompt | prompt | Everyday work; prompts teach newcomers what the agent is doing |
| `acceptEdits` | auto | prompt | Fast iteration inside a repo you trust |
| `plan` | **blocked** | read-only | Analysis, design review, anything against production infra |
| `bypassPermissions` | auto | auto | Only inside a disposable, network-isolated sandbox |

Shift+Tab cycles modes interactively.

## permission-rules

Syntax is `Tool(specifier)`; `:*` is the wildcard tail. **Deny always beats allow.**

```json
{
  "permissions": {
    "allow": ["Read(./src/**)", "Bash(npm run test:*)", "mcp__github__create_issue"],
    "ask":   ["Bash(npm run migrate:*)"],
    "deny":  ["Read(**/.env)", "Bash(git push:*)", "WebFetch"],
    "additionalDirectories": ["../packages/schema"],
    "defaultMode": "default"
  }
}
```

- `ask` = legitimate but consequential -> a human decides each time.
- `deny` = must never happen -> no prompt exists to social-engineer.
- `Bash(python:*)` is **not** a restriction: `python -c` runs anything.

## sessions

| Goal | Command |
|------|---------|
| Reopen the most recent conversation here | `claude --continue` / `-c` |
| Pick from past sessions | `claude --resume` / `-r` |
| Continue a specific session headlessly | `claude --resume <session_id> -p "…"` |
| Wipe conversation, keep working | `/clear` |
| Summarise but keep the thread | `/compact <what to keep>` |
| Roll session + files back to a checkpoint | `/rewind` |

**Habit that matters most:** one session per task. Every prior turn is re-sent on each request — a week-long mixed session costs more *and* reasons worse.

## print-mode

```bash
claude -p "Summarise today's commits" \
  --output-format json \
  --allowedTools "Bash(git log:*)" "Read" \
  --max-turns 15
```

`-p` / `--print` = non-interactive, runs to completion, exits. The only safe form for cron, CI and anything without a TTY.

## output-formats

| Format | Emits | Use for |
|--------|-------|---------|
| `text` | Final prose | Humans reading a terminal |
| `json` | One result object: result, `session_id`, duration, usage/cost, `is_error` | Pipeline gates |
| `stream-json` | Newline-delimited events as they happen (pair with `--verbose`) | Live progress + audit trail |

## slash-commands

Project (`.claude/commands/`, committed) vs personal (`~/.claude/commands/`). Discovery is filesystem-based — nothing to register.

```markdown
---
description: Verify the branch is safe to deploy
argument-hint: [environment]
allowed-tools: Bash(git status:*), Bash(git log:*), Read
model: claude-sonnet-5
---

Check whether HEAD is safe to deploy to $1.
```

`$ARGUMENTS` = whole string. `$1`, `$2`, … = positional tokens.

## context

- `@src/auth/session.ts` pulls a file into the turn — cheaper and more precise than making the agent search.
- `#` at the start of a message captures a memory entry.
- `/context` shows window occupancy; `/cost` shows spend. Different questions.
- Compact reclaims space and keeps the data; clear empties everything.

## directories

Access is scoped to the working directory. Widen with `/add-dir`, `--add-dir`, or durably via `permissions.additionalDirectories`.

## model

Pin per repository with `"model"` in committed `.claude/settings.json`. `ANTHROPIC_MODEL` works but is per-machine and drifts. `CLAUDE.md` **cannot** change the serving model.

## init

`/init` analyses the project and writes a starter `CLAUDE.md`. It is `npm init` — a scaffold you then curate.

## diagnostics

| Command | Answers |
|---------|---------|
| `/mcp` | Which MCP servers exist, their scope, their connection state, auth |
| `/doctor` | Is the installation healthy |
| `/status` | Account, model, session state |
| `/context` | What is filling the context window |
| `/cost` | What this session has spent |
| `/agents`, `/hooks` | Manage subagents and hooks |

## surfaces

CLI, IDE extensions and the desktop app are surfaces over the **same** agent: same settings hierarchy, same `CLAUDE.md`, same subagents, skills, hooks and MCP config. A committed `.claude/` works for everyone regardless of how they launch it.

## enterprise

```json
{
  "permissions": {
    "deny": ["Read(**/.env)", "Read(**/credentials.json)"],
    "disableBypassPermissionsMode": "disable"
  },
  "env": { "CLAUDE_CODE_USE_BEDROCK": "1" }
}
```

| Variable | Effect |
|----------|--------|
| `CLAUDE_CODE_USE_BEDROCK=1` | Route inference through Amazon Bedrock |
| `CLAUDE_CODE_USE_VERTEX=1` | Route inference through Google Vertex AI |
| `ANTHROPIC_BASE_URL` | Point at a corporate LLM gateway |
| `CLAUDE_CODE_ENABLE_TELEMETRY=1` | Emit OpenTelemetry metrics/events |

**Belongs in managed policy:** secret deny rules, inference endpoint, removing `bypassPermissions`.
**Belongs in the repo:** build/test commands, MCP servers that service needs, conventions.
