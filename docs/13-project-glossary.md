# 13 — Project Glossary

Official terminology. **Code/identifiers use the English term exactly**; **UI shows the Spanish
term exactly**. When speaking with the owner, use Spanish. Enum literals per Doc 04.

## Core concepts

| English (code) | Spanish (UI) | Definition |
|----------------|--------------|------------|
| Item | Ítem / Producto | Any physical thing tracked in inventory: raw material, semi-finished, or finished good. |
| Item kind | Tipo | `RAW_MATERIAL` (materia prima), `SEMI_FINISHED` (semielaborado: masa madre, kéfir base, masa en frío), `FINISHED` (producto final). |
| Recipe | Receta | Transformation formula: ingredient quantities per batch → one output item with an expected yield. |
| Batch | Tanda / Lote | One execution unit of a recipe; production is recorded in batches, costed by actual output. |
| Production run | Producción | A recorded transformation event (consumes inputs, yields output, absorbs costs). C-4. |
| Yield (actual) | Salida real | Actual quantity obtained; the denominator of unit cost, absorbs shrinkage. |
| Kardex / stock movement | Kárdex / Movimiento | System-derived, user-immutable ledger of stock entries/exits; source of truth for stock (INV-5). |
| Stock on hand | Stock / Existencias | Current quantity = Σ kardex; may be negative (INV-8). |
| WAC (weighted average cost) | Costo promedio | Item valuation cost, updated on entries (C-1). |
| Replacement cost | Costo de reposición | What it costs **today** to re-acquire/re-produce one unit (C-3); the inflation-honest cost. |
| Margin at replacement | Margen real | `price − replacement_cost`; the anti-decapitalization metric (C-5). |
| Price health | Salud de precios | Report comparing prices vs both costs, with threshold alerts (SC-12). |
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
| centavos | Storage unit of money: Bs 1,00 = 100 centavos (INV-6) |
| milli-unit | Storage unit of quantity: 1 kg → 1000 (unit `KG`) |

## Product domain (fixture catalog vocabulary)

Masa madre (sourdough starter — SEMI_FINISHED), fermento, kéfir base (SEMI_FINISHED), masa en
frío (cold-fermenting dough — SEMI_FINISHED), pan de masa madre, rollos de canela, cuñapés,
kéfir puro, kéfir con frutas, queso crema de kéfir, mantequilla ghee (from milk butter, not
kefir), empaques (PACKAGING), etiquetas (LABEL).

## Naming rules

1. Never introduce a synonym for a glossary term in code, UI, prompts, or docs; extend this
   glossary first (D-1).
2. AI prompts use the Spanish column when talking to the owner and the English column when
   emitting tool calls.
3. "Pedido" is ONLY a custom order (Modality 2); a Modality-1 transaction is always "venta".
   "Lote"/"tanda" is a production batch, never an inventory lot (no lot tracking exists).
