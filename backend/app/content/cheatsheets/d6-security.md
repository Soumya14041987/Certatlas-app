---
slug: d6-security
domain: SUPPLEMENTARY
title: Security, Permissions, Governance & Enterprise Deployment
summary: Permission semantics, prompt-injection posture, enterprise policy, audit and the residual risk you cannot configure away. (Supplementary reference — folded into CCW/CMR/AAO/PES/TDM in the real exam blueprint.)
---

## permissions

**Deny beats allow, always.** That ordering is what makes it safe to grant broadly and carve out narrowly.

| Rule list | Meaning | Use when |
|-----------|---------|----------|
| `allow` | No prompt | Safe, high-frequency operations |
| `ask` | Human decides each time | Legitimate but consequential (migrations, deploys) |
| `deny` | Refused, no prompt | Must never happen — and a prompt would be a social-engineering surface |

Least privilege in practice — for "run the Python test suite":

- Correct: `["Read", "Grep", "Glob", "Bash(pytest:*)"]`
- Wrong: `["Bash(python:*)"]` — `python -c` is arbitrary code execution wearing a specifier.

Web intake: `WebFetch(domain:docs.internal.corp)` turns an open internet feed into an allow-list.

**Confirmation fatigue is a real failure mode.** A prompt that always appears stops being a decision. Allow-list the safe high-frequency calls so the remaining prompts carry information again. (Alert fatigue, with an escalation policy attached.)

## managed-settings

| OS | Path |
|----|------|
| macOS | `/Library/Application Support/ClaudeCode/managed-settings.json` |
| Linux | `/etc/claude-code/managed-settings.json` |

Root-owned system paths, top of the precedence chain, unoverridable by any project or user config.

**Enforceable by configuration:** credential deny rules; the inference endpoint; removing `bypassPermissions`.
**Not enforceable — cultural:** "engineers must understand code they merge", "use AI thoughtfully", "code must be elegant".

## secrets

Robust: `Read(**/.env)` deny in **managed** settings + a secret-scanning hook that blocks the commit path + the same scanner as a required CI check. Two independent mechanical gates.

Weak: a `CLAUDE.md` line asking nicely; renaming files; `.gitignore` (that governs git, not the filesystem the agent reads).

Scope CI step environments to the single credential the step needs.

## prompt-injection

Injection travels through **any channel that reaches the model**: files, web pages, issue comments, tool output, MCP responses.

Effective mitigations (reduce what an injected instruction could *accomplish*):
1. Deny credential reads — nothing valuable to reach.
2. Gate outbound actions behind confirmation — no exfiltration path.
3. Allow-list the intake (domains, servers) — less untrusted content arrives.

Ineffective: scanning for "ignore previous instructions" (paraphrase wins); telling the model to distrust web content (one instruction competing with another).

It is XSS/SQLi in shape: you don't block the string, you stop untrusted input reaching an interpreter with authority.

## containment

Autonomous runs belong in a disposable container with **no outbound network except the model endpoint**. Egress control does not depend on the model behaving well — it turns exfiltration into a failed connection.

`--dangerously-skip-permissions` is defensible only when the environment reconstructs the guardrail: isolated + no production credentials, **and** output routed through human review. Vigilance, a good `CLAUDE.md`, and a stronger model are none of these.

## autonomy

Safe unattended autonomy = read-shaped authority + reviewable output + auditable reasoning.

Alert triage done right: reads telemetry, writes a triage document, **remediation requires approval**, every run emits a structured audit record, credentials scoped to read-only observability APIs. Granting restart authority makes a misclassification an outage at 3am.

## supply-chain

A repository's `.claude/` can ship hooks (shell commands run with your credentials) and MCP server definitions (processes launched on your machine). Cloning an untrusted repo and starting Claude Code inside it **is** the trust decision — same category as its build scripts.

Enterprise MCP control: a reviewed internal catalogue + managed policy restricting connections to approved servers. Not "trust engineers to choose", not "block MCP entirely".

## identity

Give the agent its own narrowly scoped credentials, distinct from the application's. It takes instructions from content it did not author, which makes it the least trustworthy actor in the system — bound its worst case well below the application's.

## deployment

| Requirement | Mechanism |
|-------------|-----------|
| Data residency (EU only) | Bedrock / Vertex in an EU region, enforced via managed settings |
| No per-developer API keys | Bedrock + existing IAM roles |
| Central logging, quotas, attribution | `ANTHROPIC_BASE_URL` -> corporate gateway, set in managed policy |

A VPN changes apparent origin, not where inference happens.

## telemetry

```json
{ "env": {
    "CLAUDE_CODE_ENABLE_TELEMETRY": "1",
    "OTEL_METRICS_EXPORTER": "otlp",
    "OTEL_EXPORTER_OTLP_ENDPOINT": "https://otel.corp.internal:4317",
    "OTEL_EXPORTER_OTLP_PROTOCOL": "grpc" } }
```

## audit

Evidence must be produced by **systems, not participants**: version control history + a `PostToolUse` audit record of tool calls (including attempts that never became commits), correlated by `session_id`, retained in an immutable retention-managed store. Record the model identifier and configuration hash at the time — the model cannot tell you later which version it was.

## credentials

Never enter a user's pasted password or token on their behalf. Consent doesn't remove the exposure: the secret is now in the transcript and everything downstream that ingests it. The human authenticates, or a purpose-built credential mechanism supplies it without passing through the conversation.

## review

Agent output deserves **at least** the rigour of human code, with extra attention to unstated assumptions, silently broadened scope, and confident claims that were never verified. Fluency makes it easy to skim and hard to disbelieve.

## onboarding

Default mode + organisation-wide deny rules for secrets and destructive commands. Prompts are a teaching mechanism for a newcomer; remove the genuinely dangerous options centrally so a wrong click can't become an incident.

## governance

Tier by risk: a strict baseline everywhere, additional controls and stronger review gates on high-risk repositories. Uniform maximum strictness drives workarounds that undermine the policy everywhere.

Shadow AI is a demand signal: provide a sanctioned tool that is genuinely better, plus a clear policy. Blocking without an alternative moves the behaviour to personal devices where you have neither visibility nor controls.

## incident-response

A blocked exfiltration attempt is a **near miss**, not a non-event: the attack path exists and exactly one layer stopped it. Investigate how untrusted content reached a session with that capability, and whether any other session had an open route. Blocklisting the attacker's domain addresses this attacker, not the class.

## residual-risk

> An agent can take a correctly permitted action that is wrong for the situation. Controls bound the blast radius; human review and mechanical verification remain the mechanism for catching wrong-but-permitted work.

Permissions answer *what may it touch*, never *was this the right change*. That is where the remaining investment goes — review capacity and verification, not another allow-list.
