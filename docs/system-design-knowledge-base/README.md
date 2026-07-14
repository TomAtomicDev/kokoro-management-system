# Kokoro Management — System Design Knowledge Base

**Version:** 1.0 · **Date:** 2026-07-06 · **Status:** Approved baseline for implementation
**Author:** Principal Architect (AI-assisted) · **Language policy:** documentation in English, UI copy in Spanish (es-BO)

Kokoro Management is an operations, inventory, costing, and cash-flow system for a one-person
artisanal food business in Bolivia. It replaces Excel spreadsheets with event-based capture
(Telegram + AI assistant on mobile, web app on desktop) and automates cost, margin, and
time-profitability calculations in a high-inflation context.

This Knowledge Base is the **single source of truth for implementation**. No developer — human
or AI — should need to invent a business rule or an architectural decision that is not written
here. If a rule is missing, the KB must be amended first (see [08 — AI Development Guide](08-ai-development-guide.md)).

## Document index

| # | Document | Contents |
|---|----------|----------|
| 01 | [Product Vision](01-product-vision.md) | Vision, goals, scope, non-goals, product principles |
| 02 | [System Architecture](02-system-architecture.md) | Topology, stack, modules, infra, security, observability |
| 03 | [Domain Model](03-domain-model.md) | Bounded context, aggregates, domain events, business rules, use cases |
| 04 | [Data Model](04-data-model.md) | Full relational schema, indexes, derived data, constraints |
| 05 | [AI Assistant Architecture](05-ai-assistant-architecture.md) | Assistant pipelines, tool registry, prompts, MCP, evaluation |
| 06 | [UX/UI Specification](06-ux-ui-specification.md) | UX principles, navigation, layout, design system, components |
| 07 | [Screen Catalog](07-screen-catalog.md) | Every screen and flow, with data, actions, and states |
| 08 | [AI Development Guide](08-ai-development-guide.md) | Repo conventions, coding rules, workflow for AI-assisted development |
| 09 | [Technical Roadmap](09-technical-roadmap.md) | Phases, milestones, dependencies |
| 10 | [Implementation Backlog](10-implementation-backlog.md) | Prioritized tasks (UI, backend, AI, infra, deployment) |
| 11 | [Testing Strategy](11-testing-strategy.md) | Unit, integration, E2E, AI evals, acceptance criteria |
| 12 | [Architecture Decision Records](12-architecture-decision-records.md) | ADR-001 … ADR-014 |
| 13 | [Project Glossary](13-project-glossary.md) | Official terminology (EN ↔ ES) |

## How to read this KB

- **Building a feature?** Start at the [Backlog](10-implementation-backlog.md) task, then read the
  linked sections of the [Domain Model](03-domain-model.md) and [Data Model](04-data-model.md).
- **Making a technical choice?** Check the [ADRs](12-architecture-decision-records.md) first; if the
  decision exists, follow it; if it conflicts with reality, write a superseding ADR.
- **Naming anything?** Use the [Glossary](13-project-glossary.md). Code identifiers are English;
  UI strings are Spanish.

## Normative language

“MUST/MUST NOT” are hard requirements. “SHOULD” is the default unless a documented reason exists.
“MAY” is optional. Anything marked **INV-x** is a system invariant that tests must enforce.
