# Bugs & Improvements — Onboarding (GH #4)

Closed triage register for [GitHub issue #4](https://github.com/TomAtomicDev/kokoro-management-system/issues/4).
All findings done. Full reasoning lives in git/PR history and in the KB (Docs 03/04) — this file is
now just the closure log.

**Source scope:** `apps/web/src/routes/onboarding.tsx`, `apps/web/src/components/onboarding/*`,
`apps/worker/src/api/onboarding.ts`, `packages/shared/src/onboarding.ts`.

## Register

| ID    | Finding                                                          | Importance | Status                  | KOK     |
| ----- | ----------------------------------------------------------------- | ---------- | ------------------------ | ------- |
| BI-01 | Opening count wrote stock in at unit cost 0                       | P0         | ✅ Done                  | KOK-084 |
| BI-02 | No initial unit cost captured for opening stock                    | P0         | ✅ Done                  | KOK-084 |
| BI-03 | Money field rejected 3 decimals with a misleading message          | P1         | ✅ Done                  | KOK-094 |
| BI-04 | Catalog row errors always said "monto inválido"                    | P1         | ✅ Done                  | KOK-095 |
| BI-05 | No way to add a row to the initial catalog                         | P1         | ✅ Done                  | KOK-089 |
| BI-06 | Catalog validation ignored kind-conditional required fields        | P1         | ✅ Done                  | KOK-096 |
| BI-07 | No way to go back a step                                           | P1         | ✅ Done                  | KOK-093 |
| BI-08 | Re-entering `/onboarding` after completion was unguarded           | P1         | ✅ Done                  | KOK-091 |
| BI-09 | Missing `PASTRY` category                                          | P2         | ✅ Done                  | KOK-097 |
| BI-10 | Missing `M` unit                                                   | P2         | ✅ Done                  | KOK-097 |
| BI-11 | `PACKAGING` kind + sale-time packaging lines                       | P2         | ✅ Done                  | KOK-100 |
| BI-12 | Seed the three starter recipes                                     | P2         | ✅ Done                  | KOK-098 |
| BI-13 | Count table: group rows by item kind                               | P2         | ✅ Done                  | KOK-092 |
| BI-14 | Count table: drop "Esperado"/"Variación", show the unit            | P2         | ✅ Done                  | KOK-088 |
| BI-15 | "Unmetered" items (Agua) — perpetual negative stock                | P2         | ✅ Done                  | KOK-100 |
| BI-16 | Catalog table forced horizontal scroll                             | P2         | ✅ Done                  | KOK-087 |
| BI-17 | Catalog header/body columns misaligned                             | P2         | ✅ Done                  | KOK-085 |
| BI-18 | Decimal separator convention never stated to the owner             | P2         | ✅ Done                  | KOK-090 |
| BI-19 | Explain why the opening count matters                              | P2         | ⏭️ Folded into BI-20     | —       |
| BI-20 | Onboarding flow rework — decouple navigation from saving           | P2         | ✅ Done                  | KOK-099 |
| BI-21 | Litre abbreviation "l" read as digit 1                             | P3         | ✅ Done                  | KOK-086 |
| BI-22 | Canonical measurement units + magnitude-scaled display/input       | P2         | ✅ Done                  | KOK-101 |
| BI-23 | Cost-rate inputs capped at 2 decimals; unclear rejection errors     | P1         | ✅ Done                  | KOK-102 |
| BI-24 | Replacement cost read as 0 right after onboarding                  | P0         | ✅ Done                  | KOK-103 |

See [Doc 10 §Phase 6.5](../system-design-knowledge-base/10-implementation-backlog.md#phase-65--onboarding-hardening-gh-4)
for what shipped in each KOK task, and Doc 03 (§4 C-3c/C-8/C-9, §3 Item aggregate) + Doc 04 (§3.1/§3.4)
for the resulting business rules.
