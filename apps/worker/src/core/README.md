# core/

Domain services (pure where possible) — the only code allowed to write to business tables
(Doc 08 D-2). `api/`, `telegram/`, `assistant/`, and `jobs/` call into `core/`; `core/` never
imports from them (Doc 02 §3 dependency rule). Each command is one service function returning
the prepared statements for a single atomic `db.batch()` (Doc 08 D-3).

Submodules, one per bounded domain area (populated across Phase 1-3 of the backlog):
`catalog/` (items, aliases, recipes), `inventory/` (kardex engine, stock, counts, exits),
`costing/` (WAC engine, replacement cost, allocation), `purchasing/`, `production/`, `sales/`,
`orders/` (custom orders + deposit liability), `finance/` (accounts, transactions, transfers,
withdrawals), `sessions/` (sessions, labor hours, shared-cost allocation), `insights/` (report
queries, price health, Bs/hour).
