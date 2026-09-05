---
slug: d5-automation
domain: SUPPLEMENTARY
title: Automation, CI/CD & SDK Architecture
summary: Headless runs, pipeline gating, the Claude Agent SDK, and the operational discipline that keeps unattended agents safe. (Supplementary reference — folded into CCW/CMR/AAO/PES/TDM in the real exam blueprint.)
---

## sdk

| | `query()` | `ClaudeSDKClient` |
|---|-----------|-------------------|
| Lifecycle | Stateless one-shot | Persistent, bidirectional |
| Turns | Single task | Multi-turn, interruptible |
| Use for | A CI step, a scheduled job | A product surface, a chat UI |

```python
from claude_agent_sdk import query, ClaudeSDKClient, ClaudeAgentOptions

async for msg in query(prompt="Summarise the failing tests",
                       options=ClaudeAgentOptions(allowed_tools=["Read", "Bash"])):
    print(msg)

async with ClaudeSDKClient(options=ClaudeAgentOptions()) as client:
    await client.query("Analyse this repository")
    async for msg in client.receive_response():
        print(msg)
    await client.query("Now propose the migration order")
```

Key `ClaudeAgentOptions` fields: `cwd` (filesystem anchor — a primary containment lever), `allowed_tools`, `permission_mode`, `system_prompt`, `mcp_servers`, `max_turns`, `model`, `can_use_tool`.

Hooks are supported programmatically in the SDK — same lifecycle model, callables instead of shell commands.

**SDK over CLI when** you need typed message handling, per-call authorisation from your own state, custom in-process tools, or many concurrent sessions. Shelling out is fine for a scripted step; it is a poor product foundation.

## sdk-permissions

```python
async def can_use_tool(tool_name, tool_input, ctx):
    if tool_name == "Bash" and "git push" in tool_input.get("command", ""):
        return {"behavior": "deny", "message": "Pushes go through the release pipeline."}
    return {"behavior": "allow", "updatedInput": tool_input}
```

The programmatic equivalent of the interactive prompt: approve, deny, or **rewrite the arguments**.

## sdk-tools

Expose your own functions without deploying anything:

```python
from claude_agent_sdk import tool, create_sdk_mcp_server, ClaudeAgentOptions

@tool("refund_order", "Issue a refund. Amount in minor units.",
      {"order_id": str, "amount_minor": int})
async def refund_order(args):
    result = await billing.refund(args["order_id"], args["amount_minor"])
    return {"content": [{"type": "text", "text": f"Refunded: {result.id}"}]}

server = create_sdk_mcp_server(name="billing", tools=[refund_order])
options = ClaudeAgentOptions(mcp_servers={"billing": server},
                             allowed_tools=["mcp__billing__refund_order"])
```

## ci-permissions

Nobody can answer a prompt in CI, so the decision must be written down in advance.

```bash
claude -p "Fix the failing unit tests and explain each change" \
  --output-format stream-json --verbose \
  --allowedTools "Read" "Grep" "Edit" "Bash(npm run test:*)" \
  --disallowedTools "Bash(git push:*)" "Bash(gh:*)" \
  --max-turns 25
```

Never `--dangerously-skip-permissions` on an unattended process — that is the worst place to have no guardrails.

## output

Gate on the structured result, never on grepped prose:

```bash
result=$(claude -p "$PROMPT" --output-format json)
if [ "$(echo "$result" | jq -r '.is_error')" = "true" ]; then
  echo "$result" | jq -r '.result' >&2; exit 1
fi
echo "$result" | jq -r '.total_cost_usd'
```

`stream-json` needs `--verbose` to emit the full event sequence — a very common first-run stumble.

## bounds

`--max-turns` caps cost and wall-clock time when the agent cannot converge. The failure mode of an unattended agent is **not stopping**; a bound turns a runaway into a visible failure.

**Fail closed.** A run that terminated on the turn limit has not verified its own work — do not promote its output.

## pipelines

Treat the agent as an untrusted build actor:

1. Scoped IAM/service role, not the pipeline's admin role.
2. Output lands on a branch + PR, never directly on the release branch.
3. Parse structured output; fail closed on `is_error`.
4. Hand results between stages as **build artefacts** — re-running costs money and may answer differently.
5. Scope the step's environment to the one credential it needs. Anything in the environment is reachable by any command the agent runs.

## github

```yaml
name: Claude
on:
  issue_comment:
    types: [created]
jobs:
  claude:
    if: contains(github.event.comment.body, '@claude')
    runs-on: ubuntu-latest
    permissions: { contents: write, pull-requests: write }
    steps:
      - uses: actions/checkout@v4
      - uses: anthropics/claude-code-action@v1
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
```

**Fork risk:** fork PR content is attacker-controlled input reaching an agent that holds your credentials. Don't expose secrets to fork-triggered runs; least-privileged token; require maintainer approval before the workflow runs.

## prompting

`--append-system-prompt` adds to the built-in prompt. `--system-prompt` **replaces** it, discarding the tool-use scaffolding that makes the agent work — only when you genuinely want a different agent.

## idempotency

Recurring automation must **reconcile**, not append. Look for the existing open PR and update it; create only if none exists. Otherwise a week of nightly runs leaves seven identical PRs. (Kubernetes controller, not a cron `create`.)

## scheduling

Mutual exclusion belongs in the **scheduler**, not the prompt — a concurrency limit or lock outside the agent process. The agent cannot reliably observe whether another instance is running.

## multi-tenancy

Every user session derives its **working directory, credentials and tool allow-list** from the authenticated user. Anything shared across tenants is a cross-tenant data path the moment a prompt goes wrong. Row-level security thinking.

## cost

Levers, in rough order of impact:
1. Run only on **changed** repositories; scope the prompt to the **diff**, not the repo.
2. Route bulk / low-judgement work to a smaller model tier.
3. Prompt caching for stable prefixes.
4. Batches API for latency-insensitive volume (~50% discount).

Hard per-engineer session caps and "turn off automation" cut the value, not the cost per unit of value.

## scaling

Rate limits: exponential backoff **with jitter**, respect retry headers, bound concurrency with a queue. Tight retry loops turn throttling into self-inflicted denial of service.

## observability

Always record `session_id` (correlation) and usage/cost (attribution). Everything else is optional; those two are what you will wish you had.

## reproducibility

Divergent runs across runners are almost always **undeclared inputs**: different Claude Code version, a `~/.claude` present on one machine, different env vars or MCP servers. Pin the version, control the environment.

## evaluation

Build an eval set of representative tasks with known-good outcomes **before** rollout. Without it, every prompt/model change is an unfalsifiable opinion and regressions are found by users.

## rollout

Canary: low-risk repositories, suggest-only authority, measure precision, then widen scope **and** authority as the numbers justify it. Never the business-critical repo first.

**Throughput must not exceed review capacity.** 40 agent PRs a week against a team that can review 10 produces unreviewed changes with a review-shaped ritual in front of them. Throttle at the source.

## sdlc

Highest value per token: **on the pull request, before human review** — bounded diff, clear intent, cheapest fix point. Nightly whole-repo sweeps re-analyse unchanged code and rediscover the same findings.

## verification

Assert on **observable state** — the diff is non-empty, the covering tests pass — never on the agent's self-report. A confident, well-formatted, incorrect summary should not be able to pass a gate.

## cli

Print mode composes with the shell — piped stdin is read as additional input alongside the prompt:

```bash
cat error.log | claude -p "Find the root cause"
```

For anything large, prefer letting the agent read the file with a scoped `Read` permission so it can seek rather than swallow the whole thing into context.

There is no `--file` or `--input` flag; `claude -p < file` supplies no prompt.
