---
name: add-event-type
description: Playbook for adding a new event type to Kokoro Management (new command/entity like a sale, purchase, or production run). Use when the task is to add a new business event type that doesn't exist yet in the KB/schema/services.
---

# Playbook: Adding a New Event Type

Follow these 10 steps; skip only if the KB says the event already exists.

1. Read Doc 03 (business rules + invariants) and Doc 04 (tables) for the event.
2. `packages/shared`: add Command/Update DTO Zod schemas + result types.
3. `db/schema.ts` + migration (if new tables/columns) — update Doc 04 (D-6).
4. `core/<module>/`: service with `record`, `update`, `delete` producing one batch (D-3): event rows + derived `stock_movements`/`financial_transactions` + `item_stock`/balance deltas + `audit_log` row.
5. Unit tests for costing/derivation logic (pure parts) + integration test for the batch (Doc 11 templates).
6. `api/`: thin routes + TanStack Query hooks in `web/src/features/<module>/`.
7. `web/`: `EventForm` + table columns + drawer wiring (reuse Doc 06 components).
8. `assistant/tools/`: `draft_<event>` tool (imports the same schema, D-4) + capture few-shot example if utterance shape is new + eval fixtures (D-7).
9. `telegram/`: confirmation-card renderer for the event type (template in `telegram/cards.ts`).
10. Update Doc 07 if a screen changed; add glossary terms if new vocabulary appeared.
