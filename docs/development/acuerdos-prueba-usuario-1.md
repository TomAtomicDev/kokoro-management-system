# User-Test 1 — Review Decisions

**Source of the observations:** issue [#23](https://github.com/TomAtomicDev/kokoro-managemnt-system/issues/23)
**Review meeting:** 2026-08-11 · Business owner + tech lead
**MVP state at review time:** Phases 0–3.1 complete (money & stock ledger, production & costing,
sales & orders, onboarding hardening). Phase 4 (Telegram + AI capture) is not built yet.

> **What this document is.** The closed record of what was decided in the review of the owner's
> first hands-on session on staging: the agreed business rules, what was rejected and why, and the
> risks accepted knowingly. It is the sole source for those decisions — the execution plan lives in
> **Phase 3.2** of
> [`10-implementation-backlog.md`](../system-design-knowledge-base/10-implementation-backlog.md).
>
> The normative rules agreed here **are not yet the KB**. Each one names the amendment that must be
> applied to Docs 03/04/07/13 (D-1: the KB is law; D-6: a schema change ships with its amendment in
> the same PR). UI strings are quoted in Spanish verbatim, per D-9.

---

## A. Structural decisions

### A-1. The "Presentación / Combo" model and the new Envasado/Armado event

The biggest decision of the session. It replaces the original question — *"does packaging carry a
list price or not?"*, which offered two bad models — with a third model that describes how the
business actually operates: **the owner packs in advance**, and what a customer buys is not "a loaf
plus a bag", it is *a bagged loaf*.

#### The problem it solves

Three distinct concepts are currently conflated:

- the **recipe**, which turns ingredients into food;
- the **packaging** that presents or groups that food;
- the **commercial offering** the customer actually buys.

That conflation produces five concrete problems, all of them observed during the test:

1. Putting packaging into recipes forces duplicating the recipe per size.
2. Deducting packaging at sale time is wrong when the packing happened days earlier.
3. Selling packaging as its own line pollutes the metrics with "Botella", "Etiqueta", "Cordel".
4. The product's margin looks inflated because the packaging cost sits somewhere else.
5. There is no real stock of "Kéfir 500 ml" or "Kéfir 1 L" even though those bottles are already
   filled and sitting in the fridge.

#### The four concepts, separated

| Concept | What it is | `kind` | Examples |
| --- | --- | --- | --- |
| **Base product** | The food before its commercial presentation | `SEMI_FINISHED` or `FINISHED`, depending on whether another *food* transformation is still needed | Bulk kéfir (L), bulk ghee (kg), sourdough loaf without a bag (unit), bulk granola |
| **Packaging** | A purchased physical input | `PACKAGING` | Bottle, cap, jar, bag, label, box, card, string |
| **Presentation** | A stockable commercial unit = a quantity of product + its packaging | `FINISHED`, unit `UNIT` | Kéfir natural 1 L, Kéfir natural 500 ml, Ghee 200 g, bagged 500 g sourdough loaf |
| **Combo** | A presentation composed of other finished presentations + outer packaging | `FINISHED`, unit `UNIT` | Desayuno Kokoro, gift basket, tasting pack, Christmas box |

Explicit rule: **being unpackaged does not make a product semi-finished.** The unbagged loaf is a
finished product; so is bulk ghee. What makes something `SEMI_FINISHED` is a missing *food*
transformation, not a missing *commercial* one.

A point to hold firm on: to have separate stock per size, "Kéfir 500 ml" and "Kéfir 1 L"
**necessarily** have to be distinct items. What this model avoids is not that — it is **duplicating
the kéfir production recipe**. The recipe stays single.

#### Production ≠ Envasado/Armado (packing/assembly)

| Production | Envasado/Armado |
| --- | --- |
| Transforms ingredients | Combines already-produced stock |
| Uses a **recipe** | Uses an **assembly definition** |
| Consumes `RAW_MATERIAL` / `SEMI_FINISHED` | Consumes `SEMI_FINISHED`, `FINISHED` and `PACKAGING` |
| Produces food | Produces a commercial presentation or combo |
| Has yield and production shrinkage | Has a gap between units planned and units actually assembled |
| Answers "how is it made?" | Answers "how is it presented or grouped?" |

**Firm decision: recipes are NOT widened to accept packaging and finished goods.** Recipes carry
their own dependency and costing rules (C-3, C-3b, C-4, the R-2 replay graph); reusing them for
combos reintroduces exactly the problem being solved. Two separate mechanisms sharing a costing
principle, not a table.

The new event must answer business phrases as they are actually spoken: *"envasé diez botellas de
kéfir de 500 ml"*, *"puse cinco panes en sus bolsas"*, *"armé cuatro desayunos Kokoro"*, *"preparé
tres cajas de degustación"*.

#### What the Envasado/Armado event records

Date and time · presentation or combo definition · planned quantity · **actual quantity obtained** ·
components actually consumed · frozen cost per component · output item · notes · session (mandatory,
see A-2).

On confirmation, **one atomic batch** (INV-1): base product(s) out + packaging out + finished
presentations/combos in + output-item WAC update + audit.

**It generates no income, no expense and no cash movement.** It is an inventory transformation: the
value that was spread across product and packaging becomes concentrated in the presentation.

#### Costing (proposed normative rule — Doc 03 §4 amendment)

```
assembly direct cost = Σ (consumed qty × frozen WAC of each component)
output unit cost     = total direct cost / actual quantity obtained
```

The result enters inventory and updates the output item's WAC through the normal mechanism (C-1).
This is the same **absorption-by-actual-output** principle production already uses (C-4): if inputs
for ten bottles were consumed and only nine usable ones came out, those nine absorb the full cost.
Breakage, spillage and loss do not artificially disappear.

Packing **time** is captured through the session and feeds Bs/hour, but is **not capitalized** into
product cost — consistent with C-7 (labor never enters cost).

#### Stock movements

Two types are added to the kardex: **`ASSEMBLY_OUT`** (content, component presentations and
packaging leaving) and **`ASSEMBLY_IN`** (the finished presentation or combo entering). Both carry
`source_event_type` + `source_event_id` as INV-9 requires. `ASSEMBLY_IN` is an **entry** type for
C-1, exactly like `PURCHASE_IN` / `PRODUCTION_IN` / `OPENING_IN`.

#### Effect on sales

Once the product is assembled:

- the sale records only "Kéfir natural 500 ml", "Ghee 200 g" or "Desayuno Kokoro";
- it deducts **only** the finished item;
- it does **not** deduct bottles, labels, boxes or component products again;
- `unit_cost_snapshot_mc` freezes the presentation's complete WAC;
- the sale's margin already includes all packaging used.

Double deduction disappears and the metrics stay clean. The customer sees
`1 × Desayuno Kokoro — Bs 60`, not six lines of string and gift cards. Components remain visible in
the internal cost breakdown, never as things the customer supposedly bought.

#### Mandatory correction to the packaging rule (Doc 03 §3, aggregates table)

The current prohibition — *"packaging is consumed exclusively during a sale"* — **is replaced by**:

> A packaging item leaves inventory when it is physically used, whether or not a sale exists.

That produces three cases, all of which must work:

1. **Exit of an already-assembled presentation** (an already-bottled Kéfir 500 ml is given away):
   record `GIFT_SAMPLE: 1 × Kéfir natural 500 ml`. The presentation's WAC already contains the
   500 ml, the bottle, the cap and the label. **No packaging is added again.**
2. **Exit of an unassembled product, without packaging** (300 ml self-consumed in her own glass):
   record `SELF_CONSUMPTION: 300 ml de Kéfir natural a granel`. No packaging leaves stock.
3. **Exit of an unassembled product, with packaging** (an unbagged loaf is given away and a bag plus
   a label are used for the gift): one single event must be able to record the main product **and**
   the packaging lines actually used.

The third case forces a modelling decision, because `stock_exits` currently holds a single
`item_id`. **Tech-lead decision:** add an optional child table of packaging lines
(`stock_exit_packaging_lines`) rather than converting `stock_exits` into a header+lines event.
Rationale: the exit is conceptually of one product and the packaging lines are an accompaniment; the
alternative would rewrite a live event vertical — its replay, its edit/delete, its UI — for an
infrequent case.

UX rules for that form:

- default to **no** packaging;
- suggest packaging **only** when the exit is of an unassembled product and an applicable definition
  exists;
- always respect manual edits;
- **never** deduct a packaging item twice when it is already contained in a presentation.

#### Documentation contradiction being resolved

Doc 04 contradicts itself: the table definition says a sale line may hold `FINISHED` **or**
`PACKAGING`; the integrity section says `FINISHED` only. Resolved in favour of:

> Ordinary sales contain only `FINISHED` items, presentations and combos included. `PACKAGING` items
> are components of Envasado/Armado, not commercial lines.

If an empty package is ever genuinely sold (a loose gift box, an upgrade), it gets modelled
explicitly as sellable merchandise — this does not reopen the door to every operational packaging
item behaving like a product. The correction ships as a **forward migration**, never by editing an
applied one.

#### Metrics: what may be asserted and what may not

The primary commercial truth is: *one Desayuno Kokoro was sold for Bs 60; it cost Bs 40,70; it
contributed Bs 19,30.* It must **not** be asserted that each component product received an observed
share of that revenue — the customer bought the bundle.

Two deliberately separate analytical layers:

- **Profitability by commercial offering** (the primary accounting metric): units sold, revenue,
  COGS, margin, replacement margin, the combo's Bs/hour.
- **Product reach** (secondary, informational): *"Pan vendido directamente: 20 · Pan incluido en
  combos vendidos: 8 · alcance total: 28"*. It informs demand and turnover **without inventing
  per-component revenue.**

If combo revenue is ever split across components, it must be labelled an **estimated analytical
allocation**, never observed revenue; individual prices may serve as weights, but the accounting
margin keeps living in the combo.

#### Worked example — "Desayuno Kokoro" (acceptance fixture)

Preserved because it is the golden-number test case for the block: illustrative figures, real
arithmetic.

*Commercial composition:* 1 × Pan de masa madre 500 g · 1 × Ghee 200 g · 1 × Kéfir natural 500 ml ·
1 box · 1 string · 1 card. **Price: Bs 60.**

**Step 1 — production.** Ordinary production runs yield unbagged loaves, bulk ghee and bulk kéfir,
with WAC of Bs 12,00/u, Bs 70,00/kg and Bs 8,00/L respectively.

**Step 2 — packing the individual presentations.**

| Assembly | Components | Total cost | Output | Output WAC |
| --- | --- | --- | --- | --- |
| Pan de masa madre 500 g | 10 loaves (Bs 120) + 10 bags (Bs 8) + 10 labels (Bs 2) | Bs 130,00 | 10 u | **Bs 13,00/u** |
| Ghee 200 g | 1 kg ghee (Bs 70) + 5 jar/cap/label sets (Bs 20) | Bs 90,00 | 5 u | **Bs 18,00/u** |
| Kéfir natural 500 ml | 5 L kéfir (Bs 40) + 10 bottle/cap/label sets (Bs 17) | Bs 57,00 | 10 u | **Bs 5,70/u** |

At this point inventory can answer correctly: *Pan 500 g: 10 · Ghee 200 g: 5 · Kéfir 500 ml: 10.*

**Step 3 — assembling five Desayunos Kokoro.**

| Component | Qty | Cost |
| --- | --- | --- |
| Pan de masa madre 500 g | 5 u | Bs 65,00 |
| Ghee 200 g | 5 u | Bs 90,00 |
| Kéfir natural 500 ml | 5 u | Bs 28,50 |
| Box | 5 u | Bs 15,00 |
| String | 5 portions | Bs 2,50 |
| Card | 5 u | Bs 2,50 |
| **Total** | | **Bs 203,50** |

Output: 5 × Desayuno Kokoro · **WAC = Bs 40,70/u**. Inventory afterwards: Pan 5 · Ghee 0 · Kéfir 5 ·
Desayuno Kokoro 5. Stock value did not vanish — it concentrated into the five breakfasts.

**Step 4 — selling one at Bs 60.** Revenue Bs 60,00 · frozen cost Bs 40,70 · **historical margin
Bs 19,30 (32,17 %)**. Desayuno Kokoro stock drops from 5 to 4 and nothing else is deducted.

**Step 5 — replacement margin.** If replacing the components today costs Bs 14,50 (presented loaf) +
Bs 19,50 (ghee) + Bs 6,20 (kéfir) + Bs 4,30 (box, string, card) = **Bs 44,50**, the replacement
margin is Bs 15,50 = **25,83 %**, below the 30 % threshold. **The system must alert**, even though
the historical margin looks healthy at 32,17 %. Price to restore 30 %:
`44,50 / (1 − 0,30) = Bs 63,57` → commercial rounding to Bs 64.

This step is precisely why a combo needs its **own WAC, composite replacement cost, own price, own
price health and both margins of its own**.

#### Non-negotiable requirements (block acceptance checklist)

1. Reusable Presentation/Combo definitions.
2. An Envasado/Armado event with real consumption and real output.
3. Presentations and combos as `FINISHED` items with stock.
4. Packaging deducted at assembly time, **not** at sale time.
5. Output WAC computed from the frozen costs of every component.
6. **Composite** replacement cost derived from the assembly definition.
7. A combo may consume other `FINISHED` presentations.
8. **Cycle prohibition**: a combo may not contain itself, directly or indirectly.
9. Sales of `FINISHED` items only.
10. Stock exits with optional packaging lines when they reflect real physical use.
11. **WAC/cost replay (R-2) must traverse assembly dependencies too**, not only recipes.
12. Edit, delete and restore with regenerated movements and soft delete (R-1, R-3, INV-10).
13. Impact preview for backdated events (R-5), exactly as production and sales have.
14. A web form now, and AI/Telegram capture of packing and assembly phrases later (Phase 4).
15. Reports that separate "offerings sold" from "products included" (tracked as KOK-050 / Phase 5 in
    the backlog, not this block — see `review-blocks-a-b-c.md` §3.7 point 1).

Point 11 is the delicate one: a backdated bottle purchase changes a presentation's WAC and then the
cost of a combo containing it. Current policy already requires such changes to propagate through the
dependency graph and to request confirmation when they affect later events; **that graph must now
span recipes *and* assembly definitions.**

#### KB amendment that formalizes the model

> A **recipe** defines how a food is produced. An **assembly definition** establishes how products
> and packaging become a stockable presentation or combo. The **Envasado/Armado** event executes
> that definition, transfers the components' cost into the result and updates stock. A **sale**
> consumes only the finished result.

Amendment scope: Doc 03 (§3 aggregates, §4 new costing rule, §7 replay graph, §9 new use case),
Doc 04 (new tables, movement types, resolution of the `sale_lines` contradiction), Doc 07 (new
screens), Doc 13 (glossary: Presentation, Combo, Assembly definition, Envasado/Armado).

---

### A-2. Sessions: mandatory link, strict by type, never blocking a record

**What was rejected:** the original request was to make the session field required on the form and
to **remove** the "Registrar compra" / "Registrar producción" buttons. That collides with product
principle #1 (*capture first, correct later*: never block a record) and with the Phase 4 goal of
≤ 30 s Telegram capture. A form that demands creating a session before noting a real purchase
produces **unrecorded events** — the worst possible outcome for this business.

**What was agreed** — the data always ends up complete without recording costing one extra click:

1. **The domain makes the link mandatory.** Every production run, every assembly and every purchase
   belongs to a session. That is what makes Bs/hour mean anything.
2. **The interaction resolves it silently.** If an OPEN session **of the matching type** exists, the
   event links to it automatically. If none exists, the system creates a minimal session of the
   right type in the same act (zero cost, same date and time), which she can complete later.
3. **The "Registrar" buttons stay**, as a shortcut that honours the rule. With the header flow
   (KOK-132) the natural path will be to start the session first anyway.
4. **Type is strict.** A purchase belongs to a `PURCHASE_TRIP` session; a production run or an
   assembly, to a `PRODUCTION` one. An event does **not** attach to an open session of another type.

**One OPEN session per type, and several types may be open at once.** The current rule (a soft
warning today) is hardened with a partial unique index: at most one `OPEN` session per `type`. The
previously floated idea of "a single globally open session" is **dropped**: if flour is delivered
mid-production, the system opens a purchase session in parallel and does **not** interrupt the
production one.

If a session of the same type is already open and another is started, the system offers
**"cerrar la anterior ahora e iniciar la nueva"** in a single step.

> **Risk accepted knowingly — overlapping hours.** With concurrent sessions, naively summing
> durations can exceed the real hours in a day, which would dilute the G3 headline
> (`Bs/hour = operating profit / logged hours`). **Agreed rule:** per-session Bs/hour (S-4) keeps
> using that session's own duration, unchanged; the **monthly business Bs/hour (G3)** uses
> **deduplicated wall-clock hours** — the union of all session intervals, counting overlapped time
> once. The screen must show both figures when they differ, with copy explaining why.

**Start time is mandatory.** Every session requires a start time. Only duration or end time is
optional. Direct consequence: **there is no "Sin horario" lane** in the weekly calendar — there are
no session without an hour to place.

**The session form has two explicit modes:** "Iniciar ahora" (one or two clicks, current time) and
"Registrar sesión pasada" (date + start + end **or** duration, mutually exclusive and validated). If
end or duration is supplied, the session is born **CLOSED** in a single step. (Today it always
stays open. Verified in the code after the meeting: that is the current *design*, not a coding slip
— `status` is hardcoded on create and the command cannot even express it — so the change moves the
schema, the service and the form together.) The unlabelled numeric field next to a shared cost's
name is the **amount in Bs**: it gets a visible label, as does the label field beside it — both
carry an `aria-label` today and no visible one.

**Weekly calendar:** cards positioned by hour, click through to the detail, **no drag and no resize**
in v1. A still-open session is drawn with a **green dot** meaning "activa" and occupies one hour by
default.

**Amendments:** Doc 03 §6 (S-1 stops being "optional for every event"; new S-5 for deduplicated
hours), Doc 04 (partial unique index for one open session per type; `session_id` NOT NULL on
purchases, production runs and assemblies).

---

### A-3. Orders

**Status reversal.** There is currently no way to undo a status change made by mistake (it happened
during the test: "Listo" was clicked by accident). Agreed:

- **Free reversal** between `CONFIRMED` ↔ `IN_PRODUCTION` ↔ `READY` — no money involved, one click
  plus a simple confirmation.
- **"Deshacer entrega"** from `DELIVERED`, with explicit confirmation and impact preview: it
  soft-deletes the sale delivery created, reverses the balance / receivable and **returns the
  deposit to the liability**, all in one atomic batch, fully audited. Covers both the misclick and
  the real case "I delivered it to the wrong person".
  *Verified against the code after the meeting:* restoring the liability needs no reversal row —
  it is derived and resumes counting the order as soon as the status leaves DELIVERED, which makes
  this simpler than it looked. One case did surface that the meeting had not considered: **if the
  sale was already collected**, the undo refuses. That money genuinely came in, and reversing a
  real collection silently is worse than telling the owner to undo the collection first.
- `CANCELLED` **stays terminal**: reactivating a cancelled order would mean redoing a refund or
  reversing a forfeited deposit already booked as income. Accounting error surface that is not worth
  it.

**No hard gate on linked production.** The request to block the move to "Listo" without a linked
production run is counterproductive: orders **do not reserve stock** (O-4) and it is perfectly
legitimate to fill an order from product already made. A hard gate would force inventing fake
zero-quantity runs, corrupting costing and WAC. **Instead:** a warning when marking Listo — *"este
pedido no tiene producción vinculada, ¿continuar?"* — with explicit confirmation.

**"Entregar" is what creates the sale.** A separate sale must not be recorded for an order: pressing
*Entregar* creates the sale, releases the deposit against it and records the balance, all in the same
atomic operation (O-2). Requiring a prior sale would either duplicate the sale or break the deposit
release. Copy is added to the Sales screen to make this obvious: *"para un pedido no necesitas
registrar una venta, usa Entregar pedido"*.

**Statuses that count for production and assembly.** The production and Envasado/Armado forms must
offer orders in **every status except `DELIVERED` and `CANCELLED`**. *Corrected after verifying the
code:* the meeting assumed the picker existed and merely filtered to CONFIRMED/IN_PRODUCTION. It
does not exist at all — `customOrderId` is never set from the production form, and the service
writes it with **no existence check and no status check**, so the API would today accept a run
linked to a cancelled or nonexistent order. The task therefore builds the control and adds the
server-side validation.

**Order lines are not removed from the form.** The "don't ask for lines when creating an order"
request is already satisfied by design: lines accept **free text with no catalog item** during
quoting, and are linked to the catalog before delivery (which is when the item exists). It is a
perception and labelling problem, not a functional one: rename, add explanatory copy, make the
initial row visibly optional. Delivery does require at least one linked line, because the sale's
lines derive from them.

**The order-line schema aligns with the Presentation/Combo model:** a linked line points to a
`FINISHED` item, which may now be a presentation or a combo.

**Order filtering is by order creation date**, not delivery date. It avoids orders with no delivery
date falling outside every range.

---

### A-4. Production's extra cost: label and tooltip, no cash movement

Review finding: a production run's "indirect cost" **never moves cash** — it only adds to the batch
cost. That is why the requested "Estimación / real" toggle would be misleading: it would distinguish
nothing, because today everything in that field is an estimate in that sense.

**Agreed:** rename the field to a descriptive label and add a tooltip stating explicitly that it is
an **estimated cost that generates no financial operation** and is used only for the product's cost.
The toggle is not implemented. A real cost that debits an account would be a new financial event
type and is out of scope.

---

### A-5. Prices and packaging

- **Packaging carries no list price** and stops being a sale line (see A-1). It keeps inventory, WAC
  and replacement cost — that does not change, and it is exactly what makes the real margin
  knowable. The feared "WAC complication" does not exist: costing already works on its own.
- **Presentations and combos do carry their own price**, own margin and own price health, including
  the **composite replacement cost** (A-1, step 5).
- **The price "Sugerencia" column stays visible.** It is currently the only direct answer to *"a qué
  precio debería subir"* and the heart of the anti-decapitalization goal (G2).
- **The starter catalog template ships with the price empty**, and the onboarding wizard **requires
  typing it before saving**. That makes the price a deliberate decision of the owner's — the real
  intent behind the request — without breaking the standing rule that price is mandatory for
  finished products (KOK-096): without it, sales, margins and price health do not work.
- **The "suggested packaging" improvement in sales is dropped** (preferred packaging per finished
  product, proportional prefill, a "restore suggested" action). The Presentation/Combo model makes it
  unnecessary: the packaging composition lives in the assembly definition. The only surviving piece
  of that idea is packaging suggestion on **exits of unassembled product** (A-1, case 3).

---

### A-6. Dates

- **Future transaction dates are rejected.** Transactions post immediately and affect today's
  balance even when they carry a future date in reports; this is not scheduled payment, and
  allowing it would communicate something false. Rejected with a clear message. Applies to
  purchases, sales, production runs, assemblies, exits and order payments. This rule covers only
  transaction `business_date` values: `custom_orders.delivery_date` is a promised calendar date,
  not a transaction date, and is explicitly allowed to be in the future.
- **Payment dates are editable** when confirming and when delivering an order (the backend already
  accepts backdating through the existing recalculation path; only the field was missing).
- **Date-range filter** on Ventas, Pedidos and Salidas, defaulting to *start of month → today*. The
  backend already supports `fromDate` / `toDate` on all three.
- **"Costo invisible del periodo" accepts exact day ranges**, not just calendar months. This requires
  changing the current month-based aggregation. The heading stops saying "del mes".

---

### A-7. Inventory counts

**Cancelling a draft count = deleting it** (soft delete, audit-reversible). No visible "Cancelado"
status is introduced. There is currently no way at all to delete a draft count — neither service nor
API: a real gap.

Counts become a **full page**. *Corrected after verifying the code:* the drawer does **not** lose
the owner's work — counted quantities are saved to the server on blur and the confirm step flushes
anything still dirty. The case for a full page is legibility on a long checklist, not data loss.
The genuine gap is the one below: a DRAFT count cannot be abandoned at all. (The `deleted_at`
column already exists and every read filters on it; nothing in the codebase ever sets it — the
plumbing is there, only the command is missing.)

---

### A-8. Receipt photo: kept in full

The requested removal is rejected. All current functionality stays: form, upload, viewer and database
column. Additional reason that weighed in: dropping the column would also close the future
possibility of receipt OCR to prefill purchases.

---

### A-9. PWA: installable shell, no offline queue

**Being built:** manifest + icon set + favicon + a service worker caching static assets. The app
installs on the phone and opens instantly. **Data still requires connectivity**, and when it is
missing, an explicit error dialog — *"No hay conexión a internet"* — on any API call.

**The offline API queue is rejected** (deferring calls and replaying them in sequence on reconnect).
Three reasons, all fundamental:

1. Local queue order **is not** domain order: an event held for days becomes a backdated event that
   triggers WAC recalculation and may require the owner's **impact confirmation** (R-5) — which needs
   a server response that is unobtainable offline. Confirming blind in advance would be inventing
   consent.
2. The idempotency infrastructure exists as a table but is **not implemented** in the routes; a queue
   without it duplicates purchases and sales on retry.
3. The system already chose its mobile-resilience mechanism: **Telegram** (Phase 4), whose retries
   and deduplication are already specified. It is settled in ADR-005, and offline mode is explicitly
   out of v1 scope.

If web offline still turns out to be needed after Telegram is in use, it gets designed as its own
phase with a KB amendment.

---

### A-10. Table sorting

Column sorting in the shared `EventTable` (opt-in per column, asc/desc/natural, Spanish collation via
`Intl.Collator`).

Two limits agreed explicitly:

- **It sorts only the rows already loaded** on screen (200–500 today). Global sorting over
  server-paginated data is a different API contract and is not justified at this volume
  (≤ 40 events/day). Agreed: **not done via API.**
- **Sorting does not combine.** Clicking a column's sort **clears** any sort on another column. One
  active column at a time.

---

### A-11. Form validation: own layer, no new dependencies

The diagnosis from the test is correct and was confirmed form by form: validation only on submit, a
single global message, no required-field marks, numeric fields that accept letters.

**Adopting React Hook Form or TanStack Form is rejected.** Neither removes the in-house
decimal→money/quantity integer conversion layer (rule D-5), both force adapting every picker and live
preview already built, and each requires an ADR for the new dependency (D-10). The estimate was
~10–18 days with a library versus **~9–14 days** improving the current pattern with own primitives.

**What gets built:** validation on blur, live revalidation after the first error, a submit summary +
highlighting + focus on the first offending field, asterisks on required fields, and length caps.
The shared Zod schemas remain the single contract (D-4). Start with `LineEditor` and the most-used
forms: catalog, purchase, sale, onboarding.

**On the "malicious code injection" concern raised:** the full render path was audited. React escapes
all free text and there is no `dangerouslySetInnerHTML` or raw-HTML render anywhere, so **there is no
real XSS vulnerability today**. Length caps and control-character sanitizing are still added as
defense in depth, but the point must not be oversized.

---

### A-12. Full pages instead of modals

The sale total did exist ("Total estimado" at the foot of the form) but fell below the fold: it took
scrolling to see. The root cause is the pattern, not that field.

**Agreed:** every line-bearing form moves to a **full page with its own URL** (shareable, real back
button, pinned summary footer): **Compra, Venta, Producción, Envasado/Armado, Pedido and Conteo.**

What does **not** change: read-only detail drawers stay, and so do the small dialogs — cobrar,
transferir, retirar, iniciar sesión and confirmations.

The **pinned footer** always shows, without scrolling: total, affected account and warnings. Also, as
the owner explicitly requested: **"Método de pago" and "Cuenta" stop being two separate fields** and
become a single selector, because they are linked (Efectivo → Caja chica, QR → Cuenta banco). The
pairing is validated **in the service**, not just in the UI, and applies to sale, collection, order
confirmation and order delivery.

**Unsaved-changes guard** on every dialog and form page, not only on Crear sesión where it was
noticed: today an outside click discards the work.

---

### A-13. Recipe timer

**Entry in min:sec from the start** (not whole minutes), and **the timer lives in the header**: the
owner can leave the recipe detail view, navigate the app, and the timer keeps running and stays
visible, with an alarm at zero. It survives a page reload. No schema change is needed: the duration is
entered at run time and the recipe's estimated-minutes field only supplies a suggested value.

---

## B. Full list of agreed quick wins

All verified against the code. None needs further discussion.

| Fix | Note |
| --- | --- |
| Favicon | None exists today; ships with the PWA icon set |
| Sticky table headers | Fixed once in `EventTable` + the 2 custom onboarding tables; confirmed to cover every table in the app |
| Calendar icons invisible in dark theme | Missing `color-scheme` in the global styles (it is the browser's native icon); one global fix covers every date input |
| Copy renames | "Líneas de compra" → **Artículos comprados**; "Productos" → **Artículos vendidos**; "Líneas del pedido" → **Artículos del pedido**; recipes' "Notas" → **Preparación**; "Contado" → **Stock inicial**; "Costo invisible del mes" → **del periodo** |
| Column headers on numeric line fields (purchases, sales, orders) + wider fields | The shared `LineEditor` renders no headers and uses narrow widths; fixed once, it benefits every form |
| Explanatory tooltips | Stock mínimo, Costos compartidos, the Estimación toggle, No medible, Costo de reposición, Alias |
| Alias tooltip, with an example | Aliases already drive catalog and picker search today, and are the basis of the Phase 4 assistant's item matching — they are not dead weight. Owner's example: *"Pan integral de 300 gr = Pint3"* |
| Shared-cost placeholder by session type | "Combustible o Transporte" / "Energía eléctrica Horno" |
| Onboarding | Align the "siguiente" arrow with "atrás"; show the "coma o punto (máx. 5 decimales)" helper once in the step instructions; drop the "Ir a configuración" buttons; align the Conteo step headers |
| Fixture: Agua at 0.00231 Bs/L | Representable at the current 5-decimal precision; changed in both fixtures — onboarding template and dev/staging SQL seed |
| Catalog ordered by kind | RAW_MATERIAL → SEMI_FINISHED → FINISHED → PACKAGING |
| "El ítem de salida no tiene precio de venta" note | Currently shown where it does not apply; condition it on the output item's kind |
| Prefill category and unit when the item kind is picked | PACKAGING → No comestible + Unidad; RAW_MATERIAL/SEMI_FINISHED → kg; FINISHED → Unidad. Create mode only, so it never overwrites an edit |
| Pencil icon / "Editar ítem" title in the catalog drawer | Direct |
| Hide "El stock quedaría en negativo" in sale edit mode | Confirmed bug: it shows while editing too |
| Item unit next to the Cantidad field in Salidas | Today the unit renders under the Ítem field — a placement error |
| Actual output prefilled from theoretical yield × batches | Already prefilled when a recipe is picked; missing is **recomputing when batches change**, without overwriting a hand-edited value. The unit shows the output item's name: "kg" → "kg de Masa madre activada" |
| Unit cost as "Bs/[output item unit]" | Plus "Cantidad" / "Aporte al costo" headers on the inputs table |
| Computed purchase total + "Se descontará X de la cuenta Y" | The data is already available in the form; it was simply not displayed |
| Per-ingredient stock indicator in production | Check / "!" — **warning only, never blocking** (stock may go negative by design, INV-8). Unmetered items (water) show a **neutral "No medido" dash**: neither check nor alert, so it never implies false confidence |
| Customer editing | The API exists but **there is no screen**: a mistyped phone number is currently unfixable from the UI. A real gap |
| Persist filters and tabs in the URL | Date range and list filters: a reload or a shared link keeps the view; also enables deep links from the future Telegram digest |
| Client-side length caps + control-character sanitizing | On every text field; cheap hardening that also improves error messages |
| Global calculator in the header | Two-line display, thumb-friendly keypad, copy button. No new dependency, built on the existing dialog primitive |
| Production "without a recipe" | Real costing already derives from actual consumption (the recipe only prefills), so it is viable: `recipe_id` becomes optional (migration) and in that mode the output item is chosen manually. Fits one-off custom orders |
| Opening stock when creating an item outside onboarding | "Tengo stock inicial" toggle with quantity and unit cost; implemented as an automatic opening mini-count in the same atomic batch (reusing C-8's `OPENING_IN` mechanism), available in Catálogo and in the inline create from Recetas |
| Edit/delete manual financial transactions | Only rows with no source event. Transfers are edited and voided as an atomic pair. Deletion is reversible (soft delete) with audit |
| Source-event column with a link in Finance | Show **"Compra · 12/08"** with a link to the corresponding screen. **No internal IDs are exposed**: events have no short human-readable code and the internal ones are unreadable UUIDs; inventing a code system adds nothing. Confirmed as sufficient |
| Add events to a session (open or closed) from its detail | Event forms receive the pre-selected session. For **closed** production sessions, adding a run must re-run the shared-cost allocation atomically (today it does **not** — a real gap) and it may move historical costs, so the standard impact warning is shown |

---

## C. Go-live commitment

**KOK-073 (`replacement_cost_history`) must be in production before the first real purchase.** That
historical series cannot be reconstructed backwards: every week without it is a week of cost-erosion
history lost forever. It is an S-sized task already in the backlog (Phase 5.5) and is **pulled
forward** to close alongside the structural block. Committed to in this session.

---

## D. Agreed sequencing

Owner's decision: **structural first, UX next, validation last.**

| Block | Contents | Why in that order |
| --- | --- | --- |
| **A — Quick wins** | Copy, tooltips, sticky headers, dark theme, favicon/PWA, filters, sorting | Cheap and risk-free; they make the app usable for continued testing while the structural work is built |
| **B — Presentation/Combo** | KB amendment, migration, definitions, assembly event, replay, FINISHED-only sales | Changes the catalog and the kardex: doing it **after** real data exists costs far more (migrating catalog, stock and historical costs) |
| **C — Sessions & orders** | Mandatory link, one open session per type, header flow, calendar, status reversal | Domain changes with migrations; same reason to land before go-live |
| **D — Forms & tools** | Full pages, live validation, calculator, timer, recipe-less production | UI surface: it can land after go-live without migrating anything |

**Realistic go-live: at the close of Block C.** Block D improves comfort, not data correctness.

---

## E. Summary of what will NOT be implemented

| Request | Why not | What is done instead |
| --- | --- | --- |
| Offline API queue (PWA) | Queue order ≠ domain order; impact confirmation is unobtainable offline; idempotency is unimplemented; ADR-005 put offline out of v1 | Installable PWA shell + explicit no-connection notice; Telegram (Phase 4) as the resilient mobile channel |
| Global sorting via API | A different API contract; unjustified at ≤ 40 events/day | Client-side sorting over loaded rows, one column at a time |
| Calendar with drag / resize | L–XL and adds nothing for a single operator | Read-only weekly calendar, click through to detail, green dot for an active session |
| "Sin horario" lane in the calendar | The case ceases to exist: start time is mandatory | — |
| Removing the "Registrar compra / producción" buttons | Contradicts capture-first; produces unrecorded events | Session link mandatory in the domain, resolved automatically by the interaction |
| A single globally open session | Would force cutting a production session short to record a purchase | One open session **per type**, with deduplicated hours for G3 |
| Requiring a sale before an order can leave "Listo" | *Entregar* already creates the sale atomically (O-2); requiring one would duplicate it | Clarifying copy on the Sales screen |
| Hard gate: "no linked production ⇒ cannot mark Listo" | Orders do not reserve stock (O-4); it would force fake zero-quantity runs | Warning with explicit confirmation |
| Reactivating cancelled orders | Would mean redoing refunds or reversing forfeited deposits already booked as income | Free reversal between Confirmado/En producción/Listo + "Deshacer entrega" |
| List prices on packaging items in the catalog | Superseded by the Presentation/Combo model | The presentation/combo carries the price; packaging is a component |
| Suggested packaging in sales (preferred packaging per product) | Unnecessary with Presentation/Combo: the composition lives in the assembly definition | Packaging suggestion only on exits of **unassembled** product |
| "Estimación / real" toggle on production's extra cost | Misleading: that cost never moves cash, so the toggle would distinguish nothing | Rename + tooltip stating it is an estimate that generates no financial operation |
| Removing the "Sugerencia" column | It is the only guide to "what price should I raise to" — the heart of G2 | Kept visible |
| Removing the receipt photo | Closes the door on future OCR; high cost to reverse | Kept in full |
| Starter catalog without a mandatory sale price | Price is mandatory for finished products (KOK-096): without it there are no sales, margins or price health | Template with an **empty** price + the wizard requires typing it before saving |
| Removing the "Líneas del pedido" section when creating an order | Free text without a catalog item is already supported; delivery does require linked lines | Renames, explanatory copy, visibly optional initial row |
| React Hook Form / TanStack Form | Does not remove the D-5 layer, forces rewriting pickers and previews, requires an ADR (D-10), and estimated slower (~10–18 d vs ~9–14 d) | Own live-validation layer over the shared Zod schemas |
