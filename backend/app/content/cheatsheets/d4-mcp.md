---
slug: d4-mcp
domain: TDM
title: Model Context Protocol & Tool Integration
summary: Architecture, primitives, scopes, transports, and the security posture that separates a good server from a liability.
---

## architecture

**Host** (the application — Claude Code) creates a **client** (one per server) that speaks to a **server** (exposes capabilities). Wire format is **JSON-RPC 2.0**.

Mental model: host = your app, client = the connection object, server = Postgres.

## primitives

| Primitive | Controlled by | Shape | Example |
|-----------|--------------|-------|---------|
| **Tools** | The **model** | Function with side effects | `create_issue`, `run_report` |
| **Resources** | The **application** | Addressable read-only content (like a GET) | A design doc, a schema |
| **Prompts** | The **user** | Templates surfaced as `/mcp__<server>__<prompt>` | "Draft a postmortem" |
| **Roots** | The **client** | Filesystem/URI boundaries offered to the server | The project directory |

Anything with a side effect is a tool. Reference a resource with `@server:protocol://path`.

**Sampling** inverts the direction: the server requests a completion through the client. Useful for agentic servers — and it spends the user's tokens, so it is designed around visibility and approval.

## transports

| Transport | Used by | Lifecycle |
|-----------|---------|-----------|
| **stdio** | Local servers launched as a subprocess | Dies with the session |
| **Streamable HTTP** | Remote servers | Independently deployed |
| SSE | Legacy remote | — |

Remote servers centralise deployment (fix once for everyone) and keep secrets server-side. They still need auth, are still subject to injection through relayed data, and their schemas still cost context.

## scope

| Scope | Storage | Visibility | Precedence |
|-------|---------|-----------|------------|
| `local` (default) | Private, per project | Just you, this project | **1 — highest** |
| `project` | `.mcp.json`, committed | Whole team | 2 |
| `user` | User config | You, every project | 3 |

Local shadows project — which lets you point a shared server name at a local build for debugging.

Project-scoped servers **require explicit approval on first encounter**. Committed is not the same as trusted.

## cli

```bash
# Remote HTTP, available in all your projects
claude mcp add --transport http --scope user sentry https://mcp.sentry.dev/mcp

# Local stdio, shared with the team via .mcp.json
claude mcp add --scope project filesystem -- npx -y @modelcontextprotocol/server-filesystem ./data

claude mcp list
```

## secrets

`.mcp.json` supports `${VAR}` and `${VAR:-default}` expansion. Commit the **shape**, never the value.

```json
{
  "mcpServers": {
    "postgres": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres"],
      "env": { "DATABASE_URL": "${DATABASE_URL}" }
    }
  }
}
```

## naming

MCP tools are namespaced `mcp__<server>__<tool>` — that is what permission rules match:

```json
{ "permissions": {
    "allow": ["mcp__github__create_issue", "mcp__github__get_pull_request"],
    "deny":  ["mcp__github__delete_repository"] } }
```

## building

A tool definition **is a prompt**. The description drives selection; the schema drives correct arguments.

```python
from mcp.server.fastmcp import FastMCP
mcp = FastMCP("orders")

@mcp.tool()
def get_order_status(order_id: str) -> dict:
    """Look up the current fulfilment status of one order.

    Use when the user asks where an order is, whether it shipped, or for its
    tracking number. Requires the full order id (e.g. ORD-91422). Read-only.
    """
    if not order_id.startswith("ORD-"):
        raise ValueError("order_id must look like ORD-12345")
    return lookup(order_id)
```

Two near-identical tools (`search` / `find`, both "searches things") means the model picks correctly ~50% of the time. Either merge them or make the descriptions genuinely distinguishing.

## limits

A tool that can only answer with *everything* is a badly designed tool. Add a filter and a page size. Output caps truncate unpredictably — they are a safety net, not a design.

## security

Design the surface to be safe **by construction**:

- Narrow, purpose-built verbs (`get_customer_status`) — never a generic `run_sql`.
- Authenticate the caller and authorise **per caller**, not per server.
- Enforce read-only at the **database role**, not in the tool description.
- Tool descriptions are hints to a model. They are not access control.

**Confused deputy:** a server holding a powerful service token that acts for any caller without checking their authorisation. Fix = caller identity + per-caller scoping (the `?tenant_id=` IDOR pattern, with a service account).

**Prompt injection:** approving a server means trusting the *server*, not the internet it relays. Mitigate architecturally — tool output is data, credential reads stay denied, outbound actions stay gated. Keyword filtering loses to paraphrase immediately.

**Vendor evaluation:** what is the blast radius of the worst tool, and where does the data go? Tool count is a cost, not a feature.

## auth

Remote servers with OAuth authenticate through `/mcp`, with tokens in secure local storage — never pasted into a committed file. In CI, use a **machine identity** (service account / scoped token from the secret store), because a pipeline that blocks on a human OAuth flow is not automation.

## when-to-use

**Build a server when:** you need a reusable, cross-application integration with structured schemas, typically wrapping a remote system.

**Don't when:** it wraps a local script (-> scoped Bash permission or a slash command) or packages a repo-local procedure (-> a skill, which costs nothing when idle, unlike ever-present tool schemas).

For 30 internal systems: group servers by **bounded context**, owned by the teams that own those systems, and enable per project. Not one 200-tool monolith; not 30 servers enabled for everyone.

## debugging

`/mcp` shows scope and connection state. Then: **run the server's command manually and read stderr.** Most failures are a missing binary, a relative path resolved from elsewhere, an unset env var, or an expired token — all visible in seconds outside the host.

## sampling

Sampling inverts the usual direction: the **server** requests a model completion **through the client**. It makes agentic servers possible — and it means a server can spend the user's tokens and shape a prompt on their behalf.

The security consideration is therefore visibility and consent: sampling requests should be surfaced, bounded, and subject to user approval, not silently honoured.
