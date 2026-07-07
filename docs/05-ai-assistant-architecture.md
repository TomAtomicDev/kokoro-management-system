# 05 — AI Assistant Architecture

The assistant is one runtime with two pipelines, exposed on two channels:

| Pipeline | Purpose | Channels |
|----------|---------|----------|
| **CAPTURE** | Natural language (text/voice) → validated **draft event** → human confirmation → core service commit | Telegram (primary), web quick-add bar |
| **QUERY** | Natural language question → curated read-only tools → grounded answer (text + optional table/chart spec) | Telegram (quick), web chat (analytical) |

Provider: **Claude API**, model `claude-sonnet-5` for both pipelines (ADR-006). Voice notes on
Telegram are transcribed by sending the audio to Claude (audio input) before the CAPTURE run; if
audio input is unavailable at build time, fall back to Cloudflare Workers AI Whisper — decision
already made: try Claude first, Whisper fallback behind the same `transcribe()` interface.

## 1. Non-negotiable safety rules

- **A-1 (INV-4):** No write executes without explicit human confirmation (Telegram button / web
  modal). The model produces drafts; the human commits.
- **A-2:** The model never writes SQL. It only calls whitelisted tools whose inputs are
  Zod-validated and whose implementations call `core/` services or read views (Doc 04 §4).
- **A-3:** Every interaction is logged to `assistant_interactions` (Doc 04 §3.5) — inputs, tool
  calls, tokens, latency, outcome.
- **A-4:** On low confidence (ambiguous item, missing qty/price), the assistant asks **one**
  compact clarifying question rather than guessing; after one clarification it presents its best
  draft with the uncertain field highlighted.
- **A-5:** Amount sanity bounds (configurable): single event > Bs 5,000 or qty > 100 kg requires
  a "¿Confirmas este monto inusual?" double-check in the confirmation card.

## 2. Tool registry

One registry (`apps/worker/src/assistant/tools/`), each tool = `{name, description, zodInput,
handler, access: 'read'|'draft'}`. The same registry is exported to (a) the Claude tool-use loop,
(b) the dev-only MCP server (§7). `draft` tools return a **proposed event payload**, they do not
commit; commits happen through the confirmation flow only (A-1).

### Read tools (QUERY)

| Tool | Input (essence) | Returns |
|------|-----------------|---------|
| `get_stock` | item filter / low_stock_only | v_stock rows |
| `get_kardex` | item, date range | movements + running balance |
| `get_cash_position` | — | balances, receivables, deposit liability, net position |
| `get_sales_summary` | date range, group_by (day/item/channel) | totals, qty, margin |
| `get_purchases_summary` | date range, group_by | totals by item/supplier |
| `get_price_health` | — | v_price_health (C-5) |
| `get_pending_orders` | status filter | orders with deposits/balances/dates |
| `get_receivables` | — | v_receivables |
| `get_waste_report` | date range | v_waste |
| `get_time_profitability` | date range | Bs/h by session type + monthly owner Bs/h (S-4) |
| `get_production_history` | item/date range | runs with unit costs & yields |
| `get_trends` | metric, granularity, range | daily_snapshots / aggregates series |
| `search_catalog` | text | items via name + aliases (used for entity resolution) |
| `get_business_context` | — | today, open sessions, pending confirmations, alerts |

### Draft tools (CAPTURE)

`draft_purchase`, `draft_production_run`, `draft_sale`, `draft_stock_exit`,
`draft_order_quote`, `draft_order_confirm`, `draft_order_deliver`, `draft_expense`,
`draft_transfer`, `draft_withdrawal`, `draft_session_open`, `draft_session_close`,
`draft_collect_receivable`, `draft_stock_adjust` (single item).

Input schemas are the same Command DTOs used by the HTTP API (`packages/shared`), so a confirmed
draft is passed to the service verbatim — zero translation layer, zero drift (ADR-008).

## 3. CAPTURE pipeline

```
input text ── Claude (system prompt + business context + tools) ──► tool_use: draft_* 
   │              │ may first call search_catalog / get_stock to resolve entities
   ▼              ▼
clarify (A-4) ◄── validation (Zod + referential checks) ──► ConfirmationCard
                                                              ├ Telegram: message + inline keyboard
                                                              │   [✅ Confirmar] [✏️ Corregir…] [❌ Descartar]
                                                              └ Web: pre-filled event form modal
on ✅ → core service commit (atomic) → receipt: "✔ Venta Bs 85 · 2× Pan masa madre · Caja chica: Bs 342"
on ✏️ → Telegram: field-by-field quick edit (buttons/numeric reply) | Web: edit the form
```

Entity resolution: item mention → exact alias match first (no tokens), else `search_catalog`
tool; if still ambiguous → clarification with up to 3 candidate buttons. New unknown item in a
purchase → offer "crear ítem nuevo" sub-flow (name, kind, category, unit) inside the same
confirmation.

Context injected per CAPTURE call (kept small, ~1–2k tokens): today's date + weekday
(America/La_Paz), account names, open session (id/type) if any, the item catalog as a compact
`name (unit, kind)` list — the catalog is < 100 items, cheap and eliminates most resolution
round-trips — plus the last 3 events of the same type for stylistic grounding.

## 4. QUERY pipeline

Claude with read tools, max 6 tool rounds, streaming. Answer contract:

- Answers ONLY from tool results; if data is insufficient it says so ("No tengo registros de…").
  Never invents numbers (tested by evals, §8).
- Amounts always in `Bs X.XX`; dates in local Spanish format.
- Web channel MAY return a `chart` block (`{type: line|bar, series…}`) that the SPA renders; the
  contract is a Zod schema in `packages/shared/assistant.ts`.
- Telegram answers ≤ ~12 lines, compact; ends with a relevant follow-up shortcut when useful
  ("¿Quieres ver el detalle por producto?").

## 5. Prompts (maintained in `apps/worker/src/assistant/prompts/`, versioned)

- `system.capture.md` — role ("asistente operativo de Kokoro"), the glossary's Spanish↔English
  event mapping, unit conventions (Bolivian usage: "una arroba", "un paquete"), drafting rules
  A-1…A-5, clarification policy, examples: 8 few-shot pairs covering purchase (multi-line, "me
  costó 120 en total"), sale ("vendí 3 kéfir a la señora Rosa, me pagó por QR"), production
  ("horneé 2 tandas de pan, salieron 17"), exit ("se me quemaron 2 panes"), deposit ("me
  adelantaron 100 para la torta del sábado"), transfer, withdrawal, session close with hours.
- `system.query.md` — grounding rules, tone (concise, warm, es-BO), formatting contract,
  anti-hallucination clause.
- Prompt changes follow Doc 08 rule D-7 (eval suite must pass before merge). Prompt files carry
  a `version:` header logged with each interaction.

## 6. Conversation state

Telegram capture is **stateless per event** with a short-lived pending-draft record
(`pending_drafts` KV in D1, TTL 30 min): one active draft per chat; a new message while a draft
is pending asks to resolve it first. Web chat keeps a rolling window of the last 20 messages
client-side and sends them with each request (no server session state). Multi-turn analytical
memory beyond the window is out of scope v1.

## 7. MCP (development & power use)

`tools/mcp-server/` wraps the same tool registry over stdio MCP for two uses:
1. **Development:** Claude Code can query staging data and exercise tools while building
   features (read tools only against prod; draft tools only against dev/staging).
2. **Owner power-user path (later):** Claude Desktop connecting to the read registry — deferred,
   not v1.
MCP is NOT in the production request path; production assistant calls the registry in-process.

## 8. Observability & evaluation

- Metrics from `assistant_interactions` (weekly job → digest + web AI Ops panel, Doc 07 SC-17):
  acceptance rate (ACCEPTED / (ACCEPTED+EDITED+REJECTED)) vs G7 ≥ 95%; most-corrected fields;
  clarification rate; median latency; token cost.
- **Eval suite** (`apps/worker/test/assistant-evals/`): ≥ 60 golden fixtures — Bolivian Spanish
  utterances → expected draft JSON (field-level match, prices/qty exact); ≥ 20 query fixtures →
  assertions on which tools are called and numeric grounding (answer must contain values present
  in seeded fixture data). Run in CI on prompt/tool changes with recorded model outputs; a
  scheduled weekly live run guards against model drift.
- Failure handling: model/API error → friendly "no pude procesar, intenta de nuevo o usa el
  formulario" + `FAILED` log; the manual form path is always available (AI is an accelerator,
  never a gate).

## 9. Cost & latency budget

| Flow | Budget |
|------|--------|
| CAPTURE round | ≤ ~3k input / 0.5k output tokens; p50 latency ≤ 4 s to confirmation card |
| QUERY (Telegram) | ≤ 2 tool rounds typical; p50 ≤ 6 s |
| QUERY (web, streamed) | first token ≤ 2 s |
| Monthly token spend | alert at US$15 (tracked from logged token counts, job `alerts`) |
