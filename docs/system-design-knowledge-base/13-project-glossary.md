# 13 — Project Glossary

Official terminology. **Code/identifiers use the English term exactly**; **UI shows the Spanish
term exactly**. When speaking with the owner, use Spanish. Enum literals per Doc 04.

## Core concepts

| English (code) | Spanish (UI) | Definition |
|----------------|--------------|------------|
| Item | Ítem / Producto | Any physical thing tracked in inventory: raw material, semi-finished, or finished good. |
| Item kind | Tipo | `RAW_MATERIAL` (materia prima), `SEMI_FINISHED` (semielaborado: masa madre, kéfir base, masa en frío), `FINISHED` (producto final), `PACKAGING` (empaque: bolsas, etiquetas — nunca insumo de receta, KOK-1xx). |
| Recipe | Receta | Transformation formula: ingredient quantities per batch → one output item with an expected yield. |
| Expected yield | Rendimiento esperado | The recipe's planned output quantity for one batch (`recipes.expected_yield_qty`); the denominator of theoretical unit cost (C-3b). Distinct from actual yield (below), which is what a production run actually gets. |
| Theoretical cost | Costo teórico | A recipe's cost per output unit computed from its lines and `expected_yield`, at WAC or at replacement cost (C-3b) — a live preview, not a cached/committed figure. Distinct from a production run's actual unit cost (C-4), which uses real consumption and actual yield. |
| Batch | Tanda / Lote | One execution unit of a recipe; production is recorded in batches, costed by actual output. |
| Production run | Producción | A recorded transformation event (consumes inputs, yields output, absorbs costs). C-4. |
| Yield (actual) | Salida real | Actual quantity obtained; the denominator of unit cost, absorbs shrinkage. |
| Kardex / stock movement | Kárdex / Movimiento | System-derived, user-immutable ledger of stock entries/exits; source of truth for stock (INV-5). |
| Stock on hand | Stock / Existencias | Current quantity = Σ kardex; may be negative (INV-8). |
| WAC (weighted average cost) | Costo promedio | Item valuation cost, updated on entries (C-1). |
| Unit cost snapshot | Costo unitario congelado | The item's WAC frozen onto an event line at the moment it was recorded (`sale_lines`, `stock_exits`, `production_consumptions`). It is what that unit **actually cost her**, and it is never rewritten by a later cost replay (R-4) — corrections book forward as costing adjustments instead. The dated series of these snapshots is the system's only real per-item cost history. |
| Cost replay | Recálculo de costo | The synchronous, forward-only recomputation of WAC/cost triggered by a backdated create/edit/delete/restore (R-2, INV-11, ADR-016); never rewrites an already-frozen snapshot (R-4). |
| Costing adjustment | Ajuste de costo | The persisted `costing_adjustments` row a cost replay books, per affected item, when its `cost_delta` is nonzero — the forward-dated correction R-4 uses instead of rewriting history. |
| Replacement cost | Costo de reposición | What it costs **today** to re-acquire/re-produce one unit (C-3); the inflation-honest cost. |
| Margin at WAC | Margen histórico | `price − WAC`; what the sale earned against what the stock actually cost. Backward-looking and always the friendlier number — never show it without the margin at replacement beside it (C-5). |
| Margin at replacement | Margen real | `price − replacement_cost`; the anti-decapitalization metric (C-5). |
| Decapitalization | Descapitalización | Selling at a price that covers the historical cost but not today's replacement cost, so each sale shrinks what the business can buy back. Nominally profitable, actually shrinking — the failure mode G2 exists to prevent. |
| Price health | Salud de precios | Report comparing prices vs both costs, with threshold alerts (SC-12). |
| Money at risk | Dinero en riesgo | An item's recent sales volume × the gap between its current margin at replacement and the target margin — the margin shortfall expressed in Bs rather than as a percentage (KOK-074). Ranks *which price to raise first*; a wide gap on something she sells twice a month matters less than a narrow one on the daily seller. |
| Price staleness | Antigüedad del precio | Days since an item's last `price_history` row, read against days since its replacement cost last moved (KOK-075). Under inflation the stale price, not the mispriced one, is the usual cause of decapitalization. |
| Input cost index | Canasta de insumos | Weighted purchase cost of the top raw materials by spend, indexed to 100 at a baseline month and built only from prices actually paid (KOK-078). The system's inflation measure; used to deflate nominal figures into real ones. |
| Purchase | Compra | Acquisition event of raw materials/packaging; updates stock, WAC, replacement cost, and cash. |
| Sale | Venta | Sale of FINISHED items; channel `CATALOG` (Modality 1) or `CUSTOM_ORDER` (Modality 2). |
| Custom order | Pedido | Modality-2 made-to-order job with deposit, delivery date/place, lifecycle O-1…O-5. |
| Deposit (advance) | Anticipo | Customer prepayment (default 50%); cash-in but a **liability** until delivery (INV-7). |
| Customer deposits (liability) | Anticipos de clientes | Total money held for undelivered orders. |
| Balance (order) | Saldo | Remainder due at delivery. |
| Receivable | Por cobrar | Sale delivered but unpaid (`ON_CREDIT`); collected via UC-04. |
| Non-commercial exit | Salida no comercial | Stock exit without sale: `WASTE` (merma), `SELF_CONSUMPTION` (autoconsumo), `GIFT_SAMPLE` (regalo/muestra), `SPOILAGE` (deterioro), `OTHER`. Valued at WAC (C-6). |
| Invisible cost | Costo invisible | Accumulated valued cost of non-commercial exits. |
| Inventory count | Conteo de inventario | Physical count; variances commit `ADJUST` movements. |
| Session | Sesión | Container for related events + shared costs + person-hours: `PRODUCTION`, `PURCHASE_TRIP` (compras), `DELIVERY_RUN` (entregas), `ADMIN`, `OTHER`. |
| Shared cost | Costo compartido | Session-level cost (fuel, energy); allocation per S-3. Estimated ones (`is_estimate`) don't touch cash. |
| Time profitability | Rentabilidad del tiempo | Bs/hour metrics per S-4; headline = monthly operating profit / logged hours (G3). |
| Financial account | Cuenta | Where money lives: `BANK` ("Cuenta Banco"), `CASH` ("Caja chica"). |
| Transfer | Transferencia | Paired movement between accounts (no P&L effect). |
| Owner withdrawal | Retiro personal | Money taken by the owner; expense category `OWNER_WITHDRAWAL`, excluded from operating costs in profit analysis, reported separately. |
| Operating expense | Gasto operativo | Business expense not tied to inventory (fuel, minor consumables, fees). |
| COGS (cost of goods sold) | Costo de lo vendido | Σ (`unit_cost_snapshot` × qty) over the sale lines of a period — what the goods *sold* in that period cost, valued at the WAC frozen at each sale. **Not the same as purchases**: buying flour converts cash into inventory and is not an expense; it becomes COGS only when the bread made from it is sold. Any profit figure computed from purchases instead of COGS will print a fake loss in every week she restocks. |
| Contribution (gross margin) | Contribución / Margen bruto | Revenue − COGS, before operating expenses. The numerator of session Bs/h (S-4) and of the per-product ranking in SC-13. |
| Operating profit | Ganancia operativa | Revenue − COGS − operating expenses, excluding owner withdrawals (which are a distribution of profit, not a cost of making it). The numerator of the monthly owner Bs/h headline (G3, S-4). |
| Net position | Posición neta | `stock value + bank + cash + receivables − customer deposits` — what the business is actually worth to her at a moment, with money held for undelivered orders excluded because it is not hers yet (ADR-012). Reported nominally and deflated by the input cost index (KOK-080); under inflation the nominal line can rise while the real one falls. |
| Business date | Fecha | Local date (America/La_Paz) an event belongs to for reporting (INV-3). |
| Event | Evento | Any user-recorded business fact (purchase, production, sale, order action, exit, count, financial movement, session). |
| Draft | Borrador | AI-proposed event awaiting human confirmation (INV-4). |
| Confirmation card | Tarjeta de confirmación | Telegram/web rendering of a draft with Confirmar/Corregir/Descartar. |
| Capture | Registro | The act of recording an event; CAPTURE is the AI pipeline for it. |
| Snapshot (daily) | Cierre diario | Nightly stored summary powering trends. |
| Alert | Alerta | Push/in-app notice: low stock, margin below threshold, negative stock, delivery due, aged receivable. |
| Audit log | Historial de cambios | Before/after record of every event mutation. |

## Payment & money terms

| English (code) | Spanish (UI) |
|----------------|--------------|
| `CASH` | Efectivo |
| `BANK_QR` | QR / Transferencia |
| `PAID` / `ON_CREDIT` | Pagado / Por cobrar |
| `ORDER_DEPOSIT` / `ORDER_BALANCE` | Anticipo de pedido / Saldo de pedido |
| `DEBT_COLLECTION` | Cobro de deuda |
| `SUPPLY_PURCHASE` | Compra de insumos |
| `DEPOSIT_REFUND` | Devolución de anticipo |
| centavos | Storage unit of money amounts — totals, balances, line totals: Bs 1,00 = 100 centavos (INV-6, ADR-017) |
| milli-centavo per whole unit (`_mc`) | Storage unit of **every per-unit rate** — sale price, unit price, WAC, replacement cost, cost snapshots: Bs 8,00 per unit → `800000`. One scale for all rates, so any two of them can be subtracted safely (ADR-017) |
| milli-unit | Storage unit of quantity: 1 kg → 1000 (unit `KG`) |
| basis points (bp) | Storage unit of percentages and rates: 30% → `3000`, 100% → `10000` (INV-6) |

## Product domain (fixture catalog vocabulary)

Masa madre (sourdough starter — SEMI_FINISHED), fermento, kéfir base (SEMI_FINISHED), masa en
frío (cold-fermenting dough — SEMI_FINISHED), pan de masa madre, rollos de canela, cuñapés,
kéfir puro, kéfir con frutas, queso crema de kéfir, mantequilla ghee (from milk butter, not
kefir), empaques y etiquetas (kind PACKAGING, not a category — KOK-1xx), agua (RAW_MATERIAL,
`isUnmetered` — KOK-1xx, C-9).

## Naming rules

1. Never introduce a synonym for a glossary term in code, UI, prompts, or docs; extend this
   glossary first (D-1).
2. AI prompts use the Spanish column when talking to the owner and the English column when
   emitting tool calls.
3. "Pedido" is ONLY a custom order (Modality 2); a Modality-1 transaction is always "venta".
   "Lote"/"tanda" is a production batch, never an inventory lot (no lot tracking exists).
