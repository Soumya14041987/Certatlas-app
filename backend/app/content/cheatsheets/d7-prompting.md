---
slug: d7-prompting
domain: PES
title: Prompt Engineering, Model Selection & Cost Architecture
summary: Structure, examples, reasoning, grounding, and the three levers that actually move an AI budget.
---

## structure

Delimit the parts so instructions can never be confused with data:

```text
<instructions>
Classify the ticket into exactly one category from <categories>.
Return only the JSON object described in <output_format>.
</instructions>

<categories>billing, outage, feature_request, how_to</categories>

<ticket>{{ticket_text}}</ticket>

<output_format>{"category": "...", "confidence": 0.0}</output_format>
```

Highest-leverage single change for long prompts — and it makes injection through the data block far less confusing to the model.

## instructions

Positive, specific, checkable beats negative and vague.

| Weak | Strong |
|------|--------|
| "Do not be verbose" | "Answer in at most three sentences, then stop" |
| "Avoid unnecessary words" | "Omit the preamble; start with the finding" |
| "Be careful with the database" | "Never issue UPDATE against `orders`; it is append-only" |

## roles

"You are a senior database reliability engineer" sets vocabulary, depth and priorities — a DBA framing surfaces locking and rollout risk unprompted. It unlocks no hidden corpus and changes no routing.

## few-shot

Two or three examples showing input -> exact expected output beat paragraphs of format specification. Include an edge case. Inconsistent output format is almost always an examples problem, not an instruction-emphasis problem.

## structured-output

1. State the schema.
2. Show one example.
3. Constrain the envelope ("respond with nothing but that JSON").
4. **Prefill** the assistant turn with the opening bracket — there is then nowhere for a preamble to go.

"Return JSON" with no schema gives you valid JSON with different keys every time, which is the harder bug to notice.

## reasoning

Step-by-step helps where **intermediate steps change the answer**: analysis, maths, debugging, planning. On a simple lookup it is pure cost; against a strict-format response it interferes unless the reasoning has a designated block.

## thinking

Extended thinking has a **configurable, billed** token budget. Spend it on hard reasoning — architectural trade-offs, subtle races, multi-step migrations. Renaming a variable across twelve files does not become more correct with a large budget, only slower and dearer. It does not compensate for an unclear prompt, and it guarantees nothing.

## long-context

With a large document, put the **question after the content**. It is the recommended order for Claude, and it aligns with caching: stable document = reusable prefix, varying question = tail.

## caching

| | Cost |
|---|------|
| Cache **write** | More than an ordinary input token |
| Cache **read** | Substantially less |

So it pays off when the prefix is **large and reused several times before expiry**.

**Ordering is the mechanism** — the cache matches on a prefix:

```
[ system prompt ][ tool definitions ][ large static document ]  <- stable, cached
[ the user's question ]                                          <- variable, last
```

Docker layer ordering: install dependencies before copying source, or every build busts the cache.

## model-selection

Route by task difficulty, not by tidiness.

| Workload | Tier |
|----------|------|
| Extract two fields from 200,000 well-formatted invoices | Smaller / faster |
| Classify log lines into a known taxonomy | Smaller / faster |
| Design a distributed-system migration | Most capable |
| Debug an intermittent race | Most capable |
| Review a security-critical auth change | Most capable |

## cost

Three levers that reduce the cost of the *same* work:
1. **Prompt caching** on stable prefixes.
2. **Right-sized routing** for bulk, low-judgement work.
3. **Batches API** for latency-insensitive volume (~50% discount, asynchronous).

Not levers: hard per-engineer caps (penalise the heaviest users, often the most productive) and switching automation off (removes the value with the cost).

**Forecasting** a 500-engineer rollout: model input/output tokens per *task type* x measured task frequency per engineer, apply realistic cache-hit and batch discounts, validate against a pilot cohort. Headcount alone predicts nothing — per-engineer usage varies by an order of magnitude, and week-one spend is unrepresentative in both directions.

## grounding

Against fabrication in a retrieval-backed assistant:
- Answer **only** from the provided documents.
- **Quote the supporting passage** — unsupported claims become visible to a reviewer.
- Provide a sanctioned way to decline: "say explicitly when the documents do not contain the answer."

Temperature 0 reduces variance, not fabrication. "Do not hallucinate" has no internal flag to consult.

## evaluation

Choose between prompt variants with a **labelled evaluation set**, comparing accuracy, cost and latency. Human intuition about prompt changes is poor — the wordier one often wins, and the elegant one sometimes quietly loses three points of recall.

## operations

Prompts are production behaviour. Editing them in a dashboard means a change with **no diff, no author, no review, no rollback**, deployed instantly. Version them in git and hold them to the same standard as any other production artefact.
