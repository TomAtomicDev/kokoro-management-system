# Graph Report - kokoro-managemnt-system  (2026-07-25)

## Corpus Check
- 448 files · ~393,427 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2792 nodes · 7761 edges · 156 communities (130 shown, 26 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 77 edges (avg confidence: 0.77)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `d8df00a6`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Recipes API & Queries
- Inventory Command Services
- Auth Routes & Audit Log
- Onboarding & Catalog API
- Backups & Dashboard API
- WAC Costing Engine
- Stock Drift Repair & Counts API
- Financial Accounts & Transactions
- Finance & Count Dialogs UI
- Production Runs API
- Domain Model Rules (Doc 03)
- Assistant Enums & Schemas
- Finance Dashboard Components
- Recharts API Reference
- Transaction & Purchase Drawers UI
- Sessions Domain Service
- Item Dialogs & Detail Drawer
- Item Form & Onboarding Steps
- Count & Exit Forms UI
- Worker Package Dependencies
- Production Movements & Kardex
- Costing Routes & Replacement Cost
- Graphify Skill Docs & Agents
- AI Assistant Architecture (Doc 05)
- Costing Adjustments & Replay
- Production Run Table UI
- Session Detail & Form UI
- Crypto Utils & CSRF
- UX/UI Component Catalog (Doc 06)
- Web App Router
- System Architecture & Cron Jobs
- Sessions API & Schemas
- Biome/TypeScript Package Config
- CalcTrace & Stock Table UI
- Event & Count Tables UI
- Finance API & Schemas
- Purchases API
- Shared Package Dependencies
- Dashboard Stat Widgets
- App Shell & Navigation
- Waste & Stock Exits Schemas
- Base TSConfig
- Scheduled Jobs Registry (KOK-021/022/029)
- Product Vision Goals (Doc 01)
- Playwright Debugging Reference
- Use Cases & Screen Catalog (Doc 07)
- AI/LLM Attack Classes
- Web TSConfig
- Purchasing Route Tests
- Domain Aggregates (Item, Session, Recipe)
- Security Attack Class Taxonomy
- shadcn Components Config
- Auth API & Smoke Tests
- Counts API & Schemas
- Golden Rules D-1..D-5 (KB)
- Web UI Dependencies
- Web Dev Dependencies
- Backup Card UI
- MCP Server Package Config
- Recharts Best Practices
- Invariants INV-5/9/10/11
- Money & Basis Point Utils
- Security Audit Skill Phases
- Route Stubs & Nav Labels
- Inventory Route Schemas
- Security Audit Methodology
- Technical Roadmap Phases (Doc 09)
- Replay Confirmation Hook
- Recipe Dependency Graph & Domain Errors
- Gitignore Patterns
- Exit/Purchase Route Tests
- Worker TSConfig
- Biome Linter Rules
- daily-snapshot.ts
- Graphify Watch & Merge Internals
- Purchasing API & Schemas
- Production Run Service Tests
- movements.ts
- Biome Config
- Shared Package TSConfig
- Sessions Route Tests
- Findings Validation Script
- MCP Server TSConfig
- Finance API Route
- ReplayImpactDto
- Graphify Query/Explain/MCP
- AGENTS.md/CLAUDE.md D-3/D-4 Duplication
- Root Package Scripts
- sales/api.ts
- Client-Side Attack Classes
- Web Package Metadata
- Chart Theme Tokens
- Biome JS Formatter Options
- HTTP/Auth Protocol Attacks
- Extraction Spec Rules
- AGENTS.md/CLAUDE.md D-2 Duplication
- AGENTS.md/CLAUDE.md D-5 Duplication
- Password Hash Script
- Biome Assist Actions
- Biome VCS Settings
- Design Brand & Tokens
- AGENTS.md/CLAUDE.md D-10 Duplication
- AGENTS.md/CLAUDE.md Graphify Section
- Catalog Route Tests
- Dashboard Route Tests
- DB Schema Tests
- Biome CSS Parser Options
- Backup Restore Runbook
- Graphify Plugin Entry
- AGENTS.md/CLAUDE.md D-1 Duplication
- AGENTS.md/CLAUDE.md D-8 Duplication
- src/audit.ts
- tailwind-merge Dependency
- KOK-034 — Orders board UI
- typescript Dependency
- api/sessions.ts
- Module README Pair
- ADR-0006 & MCP Entry
- Replay Confirmation Dialog Pair
- MCP Config & Hono Docs
- Graphify URL Ingestion
- Graphify Benchmark & Wiki Export
- Graphify Neo4j/FalkorDB Export
- Graphify Clone & Merge Commands
- Cross-Repo Graph Merge
- SPA Entry HTML
- DB Module README
- Telegram Module README
- Drizzle Migration Policy
- GraphML Export
- SVG Export
- production-runs-routes.test.ts
- src/sales.ts
- src/catalog.ts
- AppShell.tsx
- Security Audit Skill Overview
- production-runs.test.ts
- SalesRoute
- counts.test.ts
- customers-routes.test.ts
- SessionDetailDrawer.tsx
- KOK-033 — Custom-order state machine
- OrderDto
- Client-Side and Browser Hunting
- Memory Safety, Binary, and Kernel Hunting
- updateSaleCommandSchema
- SessionType
- api/backups.ts

## God Nodes (most connected - your core abstractions)
1. `nowIso()` - 109 edges
2. `Db` - 104 edges
3. `validationError()` - 73 edges
4. `generateUuidV7()` - 72 edges
5. `03 -- Domain Model` - 67 edges
6. `notFound()` - 66 edges
7. `formatMoney()` - 66 edges
8. `buildAuditLogInsert()` - 64 edges
9. `createDb()` - 55 edges
10. `Button()` - 53 edges

## Surprising Connections (you probably didn't know these)
- `Verify UI Skill` --semantically_similar_to--> `Deployment Guide`  [INFERRED] [semantically similar]
  .claude/skills/verify-ui/SKILL.md → docs/deployment-guide.md
- `kb-compliance-reviewer subagent definition` --semantically_similar_to--> `Phase 3: Validate findings`  [INFERRED] [semantically similar]
  .claude/agents/kb-compliance-reviewer.md → .agents/skills/security-audit/VALIDATION-AND-REPORTING.md
- `PBKDF2 iteration-count bug (Miniflare vs real workerd)` --semantically_similar_to--> `Workers Best Practices Rules Reference`  [INFERRED] [semantically similar]
  docs/deployment-guide.md → .claude/skills/workers-best-practices/references/rules.md
- `Workspace packages: apps/*, packages/*, tools/*` --semantically_similar_to--> `Single modular monolith on Cloudflare Workers`  [INFERRED] [semantically similar]
  pnpm-workspace.yaml → docs/system-design-knowledge-base/02-system-architecture.md
- `/graphify Skill (OpenCode)` --semantically_similar_to--> `/graphify Skill (Claude Code)`  [INFERRED] [semantically similar]
  .opencode/skills/graphify/SKILL.md → .claude/skills/graphify/SKILL.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Kokoro Management Tiered Subagent Roster** — claude_agents_kb_compliance_reviewer [INFERRED 0.85]
- **Read-only reporting subagents that lead with graphify query** — claude_agents_fast_feature_explorer_fastfeatureexplorer, claude_agents_kb_researcher_kbresearcher, concept_read_only_agent_pattern [INFERRED 0.85]
- **Semantic extraction pipeline (spec, cache/update, exports)** — claude_skills_graphify_references_extraction_spec_extractionspec, claude_skills_graphify_references_update_update, claude_skills_graphify_references_exports_exports [INFERRED 0.75]
- **Dual-platform /graphify skill (Claude Code + OpenCode)** — claude_skills_graphify_skill_graphify, opencode_skills_graphify_skill_graphifyopencode, claude_skills_graphify_references_extraction_spec_extractionspec [INFERRED 0.85]
- **Incremental graph refresh pipeline (code hooks + update + transcribe)** — opencode_skills_graphify_references_update_incremental_update, opencode_skills_graphify_references_hooks_post_commit_hook, opencode_skills_graphify_references_transcribe_step [INFERRED 0.75]
- **Backdated event edit/delete replay mechanism (KOK-024)** — docs_development_kok_024_event_edit_delete_plancostingreplay, docs_development_kok_024_event_edit_delete_updatepurchase, docs_development_kok_024_event_edit_delete_updatestockexit, docs_development_kok_024_event_edit_delete_preview_impact [EXTRACTED 1.00]
- **graphify query/path/explain + save-result feedback loop** — opencode_skills_graphify_references_query_graphify_query, opencode_skills_graphify_references_query_graphify_path, opencode_skills_graphify_references_query_graphify_explain, opencode_skills_graphify_references_query_save_result [EXTRACTED 1.00]
- **Recharts Chart Component Types** — agents_skills_recharts_references_api_reference_linechart, agents_skills_recharts_references_api_reference_barchart, agents_skills_recharts_references_api_reference_areachart, agents_skills_recharts_references_api_reference_piechart, agents_skills_recharts_references_api_reference_scatterchart, agents_skills_recharts_references_api_reference_composedchart, agents_skills_recharts_references_api_reference_radarchart, agents_skills_recharts_references_api_reference_radialbarchart, agents_skills_recharts_references_api_reference_treemap, agents_skills_recharts_references_api_reference_sankey [EXTRACTED 0.95]
- **Security Audit Six-Phase Workflow** — agents_skills_security_audit_reconnaissance_phase1, agents_skills_security_audit_hunting_phase2, agents_skills_security_audit_validation_and_reporting_phase3, agents_skills_security_audit_validation_and_reporting_phase4, agents_skills_security_audit_validation_and_reporting_phase5, agents_skills_security_audit_validation_and_reporting_phase6 [EXTRACTED 1.00]
- **Security Audit Six-Phase Workflow (Recon → Hunt → Validate → Report → Structured Output → Verify)** — claude_skills_security_audit_skill_doc, claude_skills_security_audit_reconnaissance_doc, claude_skills_security_audit_hunting_doc, claude_skills_security_audit_attack_classes_doc, claude_skills_security_audit_validation_and_reporting_doc [EXTRACTED 1.00]
- **Security Audit Domain-Specific Companion Files (Native/Binary, AI/LLM, HTTP-Protocol/Auth, Client-Side)** — claude_skills_security_audit_attack_classes_doc, claude_skills_security_audit_memory_safety_and_binary_doc, claude_skills_security_audit_ai_and_llm_doc, claude_skills_security_audit_web_protocol_and_auth_doc, claude_skills_security_audit_client_side_doc [EXTRACTED 1.00]
- **playwright-cli Skill Reference Document Set** — claude_skills_playwright_cli_skill_doc, claude_skills_playwright_cli_references_element_attributes_doc, claude_skills_playwright_cli_references_playwright_tests_doc, claude_skills_playwright_cli_references_request_mocking_doc, claude_skills_playwright_cli_references_running_code_doc, claude_skills_playwright_cli_references_session_management_doc, claude_skills_playwright_cli_references_storage_state_doc, claude_skills_playwright_cli_references_test_generation_doc, claude_skills_playwright_cli_references_tracing_doc, claude_skills_playwright_cli_references_video_recording_doc [EXTRACTED 1.00]
- **CI/CD Pipeline: build, test, migrate, deploy** — github_workflows_ci, github_workflows_deploy, github_workflows_readme, docs_deployment_guide [INFERRED 0.90]
- **Custom order lifecycle: rules, aggregate, table, screen, and use cases** — docs_system_design_knowledge_base_03_domain_model_o_1, docs_system_design_knowledge_base_03_domain_model_o_2, docs_system_design_knowledge_base_03_domain_model_o_3, docs_system_design_knowledge_base_03_domain_model_o_4, docs_system_design_knowledge_base_03_domain_model_o_5, docs_system_design_knowledge_base_03_domain_model_custom_order, docs_system_design_knowledge_base_07_screen_catalog_sc_04, docs_system_design_knowledge_base_03_domain_model_uc_05, docs_system_design_knowledge_base_03_domain_model_uc_06, docs_system_design_knowledge_base_03_domain_model_uc_07, docs_system_design_knowledge_base_03_domain_model_uc_08 [EXTRACTED 0.90]
- **Backdated WAC replay + cost-adjustment ledger mechanism** — docs_system_design_knowledge_base_03_domain_model_c_1, docs_system_design_knowledge_base_03_domain_model_r_2, docs_system_design_knowledge_base_03_domain_model_r_4, docs_system_design_knowledge_base_03_domain_model_r_5, docs_system_design_knowledge_base_03_domain_model_inv_11, docs_system_design_knowledge_base_12_architecture_decision_records_adr_009, docs_system_design_knowledge_base_12_architecture_decision_records_adr_016, docs_system_design_knowledge_base_04_data_model_costing_adjustments_table [EXTRACTED 0.90]
- **AI CAPTURE pipeline safety rules and confirmation gate** — docs_system_design_knowledge_base_05_ai_assistant_architecture_a_1, docs_system_design_knowledge_base_05_ai_assistant_architecture_a_4, docs_system_design_knowledge_base_05_ai_assistant_architecture_a_5, docs_system_design_knowledge_base_05_ai_assistant_architecture_a_6, docs_system_design_knowledge_base_03_domain_model_inv_4, docs_system_design_knowledge_base_05_ai_assistant_architecture_tool_registry, docs_system_design_knowledge_base_05_ai_assistant_architecture_capture_pipeline [EXTRACTED 0.90]

## Communities (156 total, 26 thin omitted)

### Community 0 - "Recipes API & Queries"
Cohesion: 0.10
Nodes (27): CalcTraceInput, LineEditor(), LineEditorLabels, LineEditorLine, formatBasisPointsAsPercent(), MarginBadge(), MarginBadgeProps, MarginTone (+19 more)

### Community 1 - "Inventory Command Services"
Cohesion: 0.09
Nodes (30): assertClosableDuration(), assertCostLinesValid(), assertNoLiveLinkedEvents(), buildSessionCostTransactionInput(), buildSessionCostTransactionReplacementStatements(), checkOpenSessionWarning(), deleteSession(), getSession() (+22 more)

### Community 2 - "Auth Routes & Audit Log"
Cohesion: 0.04
Nodes (73): Statement, ADR-0016, recordExit(), recordPurchase(), assistantInteractions, auditLog, costingAdjustments, customOrderLines (+65 more)

### Community 3 - "Onboarding & Catalog API"
Cohesion: 0.08
Nodes (35): RecipeEdge, topoOrderAffectedItems(), assertFiniteNonNegative(), assertSafeIntegerInput(), computePriceMargin(), computePriceSuggested(), listPriceHealth(), PriceHealthItemRow (+27 more)

### Community 4 - "Backups & Dashboard API"
Cohesion: 0.22
Nodes (15): jobRuns, BACKUP_TABLES, dumpTable(), runBackup(), serializeSqlValue(), TableDump, deleteObject(), getObject() (+7 more)

### Community 5 - "WAC Costing Engine"
Cohesion: 0.09
Nodes (34): computePurchaseLineUnitCost(), buildPurchaseInMovementsFromLines(), buildPurchaseTransactionInputs(), commitPurchaseMutation(), compareKardexRows(), computeProjectedWac(), computeReplacementCost(), deletePurchase() (+26 more)

### Community 6 - "Stock Drift Repair & Counts API"
Cohesion: 0.27
Nodes (11): CollectPaymentDialog(), SaleDetailDrawer(), computeMargin(), formatPercent(), SalesTable(), summarizeLines(), useCustomersQuery(), useReceivables() (+3 more)

### Community 7 - "Financial Accounts & Transactions"
Cohesion: 0.11
Nodes (22): RecordTransactionDialogProps, TransactionsTableProps, TransferDialogProps, WithdrawDialogProps, PurchaseDetailDrawerProps, PurchaseFormProps, PurchasesTableProps, CollectPaymentDialogProps (+14 more)

### Community 8 - "Finance & Count Dialogs UI"
Cohesion: 0.07
Nodes (33): ExitFormProps, ExitsTableProps, ACTOR, inventoryRoute, listWasteSummary(), WasteViewRow, commitCountCommandSchema, listCountsFiltersSchema (+25 more)

### Community 9 - "Production Runs API"
Cohesion: 0.16
Nodes (20): PurchaseDetailDrawer(), emptyLine(), PurchaseForm(), PurchaseFormState, purchaseToFormState(), PurchasesTable(), summarizeLines(), buildImpactRows() (+12 more)

### Community 10 - "Domain Model Rules (Doc 03)"
Cohesion: 0.05
Nodes (46): 03 -- Domain Model, C-2 Purchase unit cost = line_total / qty, C-4 Production run cost (direct + indirect + allocated session cost), C-6 Exit valuation at current WAC, DailySnapshot (aggregate root), Domain events (past-tense, logs/hooks/toasts), Event-sourced-lite modeling stance, FinancialTransaction (aggregate root) (+38 more)

### Community 11 - "Assistant Enums & Schemas"
Cohesion: 0.06
Nodes (36): AuditLogEntryDto, auditLogEntryDtoSchema, ListAuditLogResult, ASSISTANT_CHANNELS, ASSISTANT_OUTCOMES, ASSISTANT_PIPELINES, AssistantChannel, assistantChannelSchema (+28 more)

### Community 12 - "Finance Dashboard Components"
Cohesion: 0.13
Nodes (28): CreateItemDialog(), CreateItemDialogProps, ItemDetailDrawer(), ItemDetailDrawerProps, emptyItemFormValues(), ItemForm(), ItemFormProps, itemFormValuesFromDto() (+20 more)

### Community 13 - "Recharts API Reference"
Cohesion: 0.10
Nodes (41): Recharts API Reference, AreaChart component, BarChart component, Brush component, CartesianGrid component, Cell component (deprecated, removed in Recharts 4.0), ComposedChart component, Legend component (+33 more)

### Community 14 - "Transaction & Purchase Drawers UI"
Cohesion: 0.12
Nodes (31): assertSaleNotCollected(), buildSaleDeleteMutationInputs(), buildSaleOutMovementsFromLines(), buildSaleTransactionInputs(), buildSaleUpdateMutationInputs(), commitSaleMutation(), deleteSale(), FinancialAccountRow (+23 more)

### Community 15 - "Sessions Domain Service"
Cohesion: 0.07
Nodes (39): filtersToQueryString(), orderDetailKey(), ORDERS_ROOT_KEY, ordersListKey(), useOrder(), useOrders(), OrdersRoute(), ACTOR (+31 more)

### Community 16 - "Item Dialogs & Detail Drawer"
Cohesion: 0.09
Nodes (28): ProductionRunFormProps, filtersToQueryString(), PRODUCTION_RUNS_ROOT_KEY, productionRunDetailKey(), productionRunsListKey(), useProductionRun(), useProductionRuns(), SessionCostAllocationResult (+20 more)

### Community 17 - "Item Form & Onboarding Steps"
Cohesion: 0.06
Nodes (68): getCurrentWac(), ADR-0016, PendingMovementChange, snapshotUnitCost(), DOMAIN_ERROR_CODES, DOMAIN_ERROR_HTTP_STATUS, DomainErrorCode, DomainHttpStatus (+60 more)

### Community 18 - "Count & Exit Forms UI"
Cohesion: 0.10
Nodes (28): auditRoute, costingRoute, errorHandler(), healthRoute, ACTOR, onboardingRoute, productionRunsRoute, ACTOR (+20 more)

### Community 19 - "Worker Package Dependencies"
Cohesion: 0.05
Nodes (39): dependencies, drizzle-orm, hono, @kokoro/shared, zod, devDependencies, @cloudflare/vitest-pool-workers, @cloudflare/workers-types (+31 more)

### Community 20 - "Production Movements & Kardex"
Cohesion: 0.16
Nodes (25): buildProductionMovementsFromConsumptions(), buildProductionRunCreateInputs(), buildProductionRunDeleteInputs(), buildProductionRunUpdateInputs(), commitProductionRunMutation(), compareKardexRows(), computeProductionCosts(), computeProjectedItemWacAcrossRuns() (+17 more)

### Community 21 - "Costing Routes & Replacement Cost"
Cohesion: 0.11
Nodes (29): ProductionRunDetailDrawer(), ProductionRunDetailDrawerProps, emptyLine(), ProductionRunForm(), ProductionRunFormState, productionRunToFormState(), formatBatches(), formatYieldPct() (+21 more)

### Community 22 - "Graphify Skill Docs & Agents"
Cohesion: 0.09
Nodes (35): fast-feature-explorer Agent, kb-researcher Agent, quick Agent (fast tier), .claude/CLAUDE.md (graphify project directive), graphify add & --watch reference, graphify extra exports & benchmark reference, graphify extraction subagent prompt spec, graphify GitHub clone & cross-repo merge reference (+27 more)

### Community 23 - "AI Assistant Architecture (Doc 05)"
Cohesion: 0.10
Nodes (35): 05 -- AI Assistant Architecture, A-2 Model never writes SQL, only whitelisted Zod-validated tools, A-3 Every interaction logged to assistant_interactions, A-4 On low confidence, ask one compact clarifying question, A-5 Amount sanity bounds require double-check, Draft tool: draft_collect_receivable, Draft tool: draft_expense, Draft tool: draft_order_confirm (+27 more)

### Community 24 - "Costing Adjustments & Replay"
Cohesion: 0.12
Nodes (22): ItemPicker(), CreateCustomerDialog(), CustomerForm(), CustomerFormParsed, CustomerFormProps, CustomerFormValues, emptyCustomerFormValues(), parseCustomerFormValues() (+14 more)

### Community 25 - "Production Run Table UI"
Cohesion: 0.10
Nodes (39): LiabilityReceivableStrip(), RecordTransactionDialog(), TransferDialog(), WithdrawDialog(), exitFormInitialState, CancelOrderDialog(), ConfirmOrderDialog(), DeliverOrderDialog() (+31 more)

### Community 26 - "Session Detail & Form UI"
Cohesion: 0.17
Nodes (11): Topbar(), fetchSession(), sessionQueryKey, SessionResult, useLogin(), useLogout(), api, authLabels (+3 more)

### Community 27 - "Crypto Utils & CSRF"
Cohesion: 0.15
Nodes (19): CostingAdjustmentTrigger, applyProductionCostCorrections(), buildNegativeSinceFixes(), comparePoints(), computeNegativeSince(), CostingReplayInput, CostingReplayPlan, FrozenSnapshot (+11 more)

### Community 28 - "UX/UI Component Catalog (Doc 06)"
Cohesion: 0.07
Nodes (31): O-3 Cancel after deposit: REFUND or FORFEIT, R-5 Impact preview + explicit confirmation before a replay-triggering commit, 06 -- UX/UI Specification, Component: AlertsPanel, Component: CalcTrace, Component: ChatPanel, Component: ConfirmDraftCard, Component: CustomerPicker (+23 more)

### Community 29 - "Web App Router"
Cohesion: 0.08
Nodes (24): assistantRoute, authenticatedRoute, financeRoute, inventoryRoute, loginRoute, onboardingRoute, ordersRoute, panelRoute (+16 more)

### Community 30 - "System Architecture & Cron Jobs"
Cohesion: 0.09
Nodes (28): 02 -- System Architecture, Cron job: alerts, Cron job: backup, Command flow (any write, any channel), Known gap: Workers Free plan 5-cron-trigger cap blocks deploy-prod (KOK-061), Cron job: daily-snapshot, Event editing flow, Single modular monolith on Cloudflare Workers (+20 more)

### Community 31 - "Sessions API & Schemas"
Cohesion: 0.07
Nodes (43): SessionChip(), SessionFormProps, SessionFormState, formatDuration(), SessionsTable(), SessionsTableProps, filtersToQueryString(), sessionDetailKey() (+35 more)

### Community 32 - "Biome/TypeScript Package Config"
Cohesion: 0.07
Nodes (27): @biomejs/biome, description, devDependencies, @biomejs/biome, typescript, devEngines, packageManager, engines (+19 more)

### Community 33 - "CalcTrace & Stock Table UI"
Cohesion: 0.13
Nodes (20): StepBalances(), StepBalancesProps, FIXTURE_ITEMS, fixtureToRow(), StepCatalog(), StepCatalogProps, StepPassword(), StepPasswordProps (+12 more)

### Community 34 - "Event & Count Tables UI"
Cohesion: 0.10
Nodes (41): CalcTrace(), CalcTraceProps, EventTable(), EventTableColumn, EventTableProps, AccountCard(), TransactionsTable(), CountForm() (+33 more)

### Community 35 - "Finance API & Schemas"
Cohesion: 0.15
Nodes (22): DetailDrawer(), DetailDrawerProps, editCountLabel(), CountDetailView(), ExitDetailDrawer(), ExitDetailDrawerProps, errorMessage(), ExitForm() (+14 more)

### Community 36 - "Purchases API"
Cohesion: 0.10
Nodes (26): filtersToQueryString(), purchaseDetailKey(), PURCHASES_ROOT_KEY, purchasesListKey(), readCsrfCookie(), uploadPurchasePhoto(), UploadPurchasePhotoResult, usePurchase() (+18 more)

### Community 37 - "Shared Package Dependencies"
Cohesion: 0.09
Nodes (22): dependencies, zod, devDependencies, fast-check, @types/node, typescript, vitest, exports (+14 more)

### Community 38 - "Dashboard Stat Widgets"
Cohesion: 0.16
Nodes (15): LowStockStrip(), QuickAddShortcuts(), SHORTCUTS, StatCard(), StatCardDelta, StatCardProps, AppPath, useQuickAdd() (+7 more)

### Community 39 - "App Shell & Navigation"
Cohesion: 0.14
Nodes (16): AppShell(), MobileBottomTabs(), mobileTabPaths, moreEntries, footerNav, mobileTabs, NavActionItem, NavDivider (+8 more)

### Community 40 - "Waste & Stock Exits Schemas"
Cohesion: 0.24
Nodes (7): ToastProvider(), handleUnauthorized(), mutationCache, queryCache, queryClient, rootElement, router

### Community 41 - "Base TSConfig"
Cohesion: 0.09
Nodes (21): compilerOptions, declaration, declarationMap, esModuleInterop, forceConsistentCasingInFileNames, isolatedModules, lib, module (+13 more)

### Community 42 - "Scheduled Jobs Registry (KOK-021/022/029)"
Cohesion: 0.10
Nodes (21): detectWacDrift (core/costing, referenced in jobs README), getBalanceConsistencyMismatches (core/finance), getStockConsistencyMismatches (core/inventory), runBackup (KOK-022), runDailySnapshot (KOK-021), runJob(db, jobName, bucket) registry, runReplacementCostRefresh (KOK-029), detectWacDrift (core/costing/repair.ts, KOK-024 nightly backstop) (+13 more)

### Community 43 - "Product Vision Goals (Doc 01)"
Cohesion: 0.10
Nodes (21): 01 -- Product Vision, G1 Effortless event capture, G3 Time profitability (Bs/hour), G4 Trustworthy stock, G5 Clean cash, G6 Low cost & maintenance, G7 AI reliability (>=95% draft acceptance), Principle: AI is observable (+13 more)

### Community 44 - "Playwright Debugging Reference"
Cohesion: 0.15
Nodes (20): Inspecting Element Attributes, --debug=cli / attach Mechanic, Running and Debugging Playwright Tests, Request Mocking, Running Custom Playwright Code, run-code Command, attach Command (Session Management), Browser Session Management (+12 more)

### Community 45 - "Use Cases & Screen Catalog (Doc 07)"
Cohesion: 0.08
Nodes (31): CountsTableProps, countsFiltersToQueryString(), exitsFiltersToQueryString(), INVENTORY_ROOT_KEY, KardexFilters, kardexFiltersToQueryString(), stockFiltersToQueryString(), UpdateCountLineInput (+23 more)

### Community 46 - "AI/LLM Attack Classes"
Cohesion: 0.11
Nodes (19): AI, LLM, and Agent Hunting Doc, Agent and tool-calling attack classes, Output-handling and disclosure attack classes, Prompt-injection attack classes, Attack Classes Doc, Access control attack class, Business logic attack class, Cryptography and secrets attack class (+11 more)

### Community 47 - "Web TSConfig"
Cohesion: 0.11
Nodes (18): compilerOptions, jsx, lib, outDir, paths, rootDir, types, extends (+10 more)

### Community 48 - "Purchasing Route Tests"
Cohesion: 0.33
Nodes (9): authHeaders(), createItem(), createPurchase(), CreatePurchaseBody, getCookieValue(), login(), PurchaseDtoShape, PurchaseLineBody (+1 more)

### Community 49 - "Domain Aggregates (Item, Session, Recipe)"
Cohesion: 0.11
Nodes (19): Principle: Deposits are debt, not income, C-1 Weighted average cost (WAC) valuation, C-3b Recipe theoretical cost (KOK-025 amendment), CustomOrder (aggregate root), INV-7 Custom-order deposit is a liability until delivery, Item (aggregate root), Recipe (aggregate root), Session (aggregate root) (+11 more)

### Community 50 - "Security Attack Class Taxonomy"
Cohesion: 0.12
Nodes (18): Chained attacks and trust boundaries attack class, AI, LLM, and Agent Hunting, Excessive Agency / Confused-Deputy Authority, Insecure Output Rendering (Model Output XSS), Prompt-Injection Attack Classes, Access Control Attack Class, Business Logic Attack Class, Attack Classes (+10 more)

### Community 51 - "shadcn Components Config"
Cohesion: 0.11
Nodes (17): aliases, components, hooks, lib, ui, utils, iconLibrary, rsc (+9 more)

### Community 52 - "Auth API & Smoke Tests"
Cohesion: 0.10
Nodes (30): CreateCustomerDialogProps, CustomerPickerProps, customerDetailKey(), CUSTOMERS_ROOT_KEY, customersListKey(), filtersToQueryString(), useCustomerQuery(), useInvalidateCustomers() (+22 more)

### Community 53 - "Counts API & Schemas"
Cohesion: 0.20
Nodes (8): ACTOR, CONTENT_TYPE_EXTENSIONS, purchasingRoute, deletePurchaseCommandSchema, listPurchasesFiltersSchema, purchaseImpactRequestSchema, recordPurchaseCommandSchema, updatePurchaseCommandSchema

### Community 54 - "Golden Rules D-1..D-5 (KB)"
Cohesion: 0.11
Nodes (18): core/ never imports from api/telegram/assistant/jobs dependency rule, INV-1 Every command commits in one atomic batch, INV-6 Money/qty stored as integers, Component: UndoToast, 08 -- AI Development Guide, D-1 The KB is law, D-10 No new dependencies without an ADR note, D-2 All writes go through core/ services (+10 more)

### Community 55 - "Web UI Dependencies"
Cohesion: 0.12
Nodes (17): dependencies, class-variance-authority, clsx, @kokoro/shared, lucide-react, react, react-dom, @tanstack/react-query (+9 more)

### Community 56 - "Web Dev Dependencies"
Cohesion: 0.12
Nodes (17): devDependencies, @playwright/test, tailwindcss, @tailwindcss/vite, @types/react, @types/react-dom, vite, @vitejs/plugin-react (+9 more)

### Community 57 - "Backup Card UI"
Cohesion: 0.21
Nodes (11): BackupCard(), formatBytes(), ADR-0015, backupDownloadUrl(), ADR-0015, useBackupStatus(), backupsLabels, TODO: migrate into packages/shared/i18n/es.ts once that module exists (KOK-006+) (+3 more)

### Community 58 - "MCP Server Package Config"
Cohesion: 0.12
Nodes (16): dependencies, @kokoro/shared, description, devDependencies, tsx, typescript, @kokoro/shared, typescript (+8 more)

### Community 59 - "Recharts Best Practices"
Cohesion: 0.16
Nodes (16): Cell Component (deprecated, use shape prop), Recharts API Reference, ZIndexLayer / Z-Index Layering, accessibilityLayer / Keyboard Navigation, Recharts Best Practices, useMemo/useCallback Memoization Pattern, Recharts Examples, AreaChart Component (+8 more)

### Community 60 - "Invariants INV-5/9/10/11"
Cohesion: 0.14
Nodes (16): costing_adjustments row booking (R-4), INV-10 Deleting an event soft-deletes and reverses derived rows, INV-11 Backdated create/edit/delete triggers synchronous bounded WAC/cost replay, INV-5 item_stock/balances must equal derived sums (nightly check), INV-9 Derived rows carry source_event_type/id; no orphans, R-2 WAC replayed synchronously for backdated events (revised by ADR-016), costing_adjustments table (R-4), financial_transactions table (+8 more)

### Community 61 - "Money & Basis Point Utils"
Cohesion: 0.24
Nodes (13): CostingAdjustmentEntry, allocateLargestRemainder(), BasisPoints, Centavos, mulMoneyByBasisPoints(), mulMoneyByQty(), roundHalfUpToInt(), ADR-0011 (+5 more)

### Community 62 - "Security Audit Skill Phases"
Cohesion: 0.05
Nodes (65): filtersToQueryString(), recipeDetailKey(), RECIPES_ROOT_KEY, recipesListKey(), useRecipeQuery(), ACTOR, recipesRoute, buildCostDto() (+57 more)

### Community 63 - "Route Stubs & Nav Labels"
Cohesion: 0.26
Nodes (8): RouteStub(), navLabels, placeholderLabels, TODO: migrate into packages/shared/i18n/es.ts once that module exists (KOK-006+), AssistantRoute(), PriceHealthRoute(), ReportsRoute(), SettingsAiRoute()

### Community 64 - "Inventory Route Schemas"
Cohesion: 0.22
Nodes (11): ACCOUNTS_KEY, ITEMS_ROOT_KEY, ONBOARDING_ROOT_KEY, BulkCreateItemsCommand, bulkCreateItemsCommandSchema, BulkCreateItemsResult, OnboardingCompleteResult, OnboardingStatusResult (+3 more)

### Community 65 - "Security Audit Methodology"
Cohesion: 0.17
Nodes (15): Plan → Generate → Heal Workflow, Vulnerability Hunting, Hunting Methodology (12 Attack Angles), Phase 2 Validation Rules, Reconnaissance, Phase 1 Recon Agents (1a/1b/1c), Security Audit Skill Guide, "Only Report What You Can Exploit" Principle (+7 more)

### Community 66 - "Technical Roadmap Phases (Doc 09)"
Cohesion: 0.25
Nodes (15): INV-8 Stock MAY go negative; flag, never block, 09 -- Technical Roadmap, Phase 0 -- Foundations, Phase 1 -- Money & Stock Ledger, Phase 2 -- Production & Costing, Phase 3 -- Sales & Custom Orders, Phase 4 -- Telegram + AI Capture, Phase 5 -- Insights & Analytical AI (+7 more)

### Community 67 - "Replay Confirmation Hook"
Cohesion: 0.20
Nodes (11): ACTOR, getProductionRun(), listProductionRuns(), loadProductionRunForRestore(), restoreProductionRun(), toProductionRunDto(), deleteProductionRunCommandSchema, listProductionRunsFiltersSchema (+3 more)

### Community 68 - "Recipe Dependency Graph & Domain Errors"
Cohesion: 0.22
Nodes (8): ACTOR, salesRoute, collectPaymentCommandSchema, deleteSaleCommandSchema, listSalesFiltersSchema, recordSaleCommandSchema, saleImpactRequestSchema, updateSaleCommandSchema

### Community 69 - "Gitignore Patterns"
Cohesion: 0.13
Nodes (15): includes, **, !**/.agents, !**/apps/worker/migrations, !**/.claude, !**/*.d.ts, !**/.design, !**/dist (+7 more)

### Community 70 - "Exit/Purchase Route Tests"
Cohesion: 0.30
Nodes (11): authHeaders(), createExit(), CreateExitBody, createItem(), createPurchase(), CreatePurchaseBody, ExitDtoShape, getCookieValue() (+3 more)

### Community 71 - "Worker TSConfig"
Cohesion: 0.15
Nodes (12): compilerOptions, outDir, rootDir, types, extends, include, src, ../../tsconfig.base.json (+4 more)

### Community 72 - "Biome Linter Rules"
Cohesion: 0.17
Nodes (12): noForEach, linter, enabled, rules, complexity, preset, style, suspicious (+4 more)

### Community 73 - "daily-snapshot.ts"
Cohesion: 0.24
Nodes (6): createDb(), getCookieValue(), login(), getCookieValue(), login(), PriceHealthRow

### Community 74 - "Graphify Watch & Merge Internals"
Cohesion: 0.18
Nodes (11): Debounce mechanism for --watch, graphify --watch (folder watcher), git post-commit hook (graphify hook install), Video/audio transcription step (Step 2.5), transcribe_all() (graphify.transcribe), Whisper initial prompt (domain hint), build_merge() (graphify.build), graphify --cluster-only (+3 more)

### Community 75 - "Purchasing API & Schemas"
Cohesion: 0.27
Nodes (7): recordProductionRun(), productionRuns, ACTOR, seedItem(), seedRecipe(), seedScenario(), TestDb

### Community 76 - "Production Run Service Tests"
Cohesion: 0.09
Nodes (22): ACTOR, financeRoute, FinancialAccountType, financialTransactionCategorySchema, amountSchema, businessDateSchema, descriptionSchema, ListAccountsResult (+14 more)

### Community 77 - "movements.ts"
Cohesion: 0.18
Nodes (29): AuditEntry, buildAuditLogInsert(), listAuditLogForEntity(), addItemAlias(), removeItemAlias(), bulkCreateItems(), ItemRow, Statement (+21 more)

### Community 78 - "Biome Config"
Cohesion: 0.22
Nodes (9): files, ignoreUnknown, formatter, enabled, indentStyle, indentWidth, lineWidth, formatter (+1 more)

### Community 79 - "Shared Package TSConfig"
Cohesion: 0.20
Nodes (9): compilerOptions, outDir, rootDir, types, extends, include, node, src (+1 more)

### Community 80 - "Sessions Route Tests"
Cohesion: 0.32
Nodes (7): authHeaders(), createSession(), CreateSessionBody, getCookieValue(), login(), SessionCostLineBody, SessionDtoShape

### Community 81 - "Findings Validation Script"
Cohesion: 0.36
Nodes (7): collect(), findDiscriminator(), fs, path, schemaPath, typeOf(), validate()

### Community 82 - "MCP Server TSConfig"
Cohesion: 0.25
Nodes (7): compilerOptions, outDir, rootDir, extends, include, src, ../../tsconfig.base.json

### Community 83 - "Finance API Route"
Cohesion: 0.10
Nodes (50): buildCostingAdjustmentInsert(), assertSafeIntegerInput(), assertValidTransactionAmount(), BalanceMismatchDto, BalanceMismatchRow, buildAccountBalanceDelta(), buildReplaceTransactionsForSourceStatements(), buildTransactionInsert() (+42 more)

### Community 84 - "ReplayImpactDto"
Cohesion: 0.24
Nodes (8): affectedIdsSchema, confirmFlagSchema, costDeltaSchema, ReplacementCostRefreshResultDto, ReplayConfirmationRequiredDetails, replayImpactSchema, emptyImpact, ADR-0016

### Community 85 - "Graphify Query/Explain/MCP"
Cohesion: 0.29
Nodes (7): graphify MCP server (--mcp, graphify.serve), graphify explain (single-node explanation), graphify path (shortest path between concepts), graphify query (BFS/DFS traversal), graphify reflect / LESSONS.md, save-result (work-memory feedback loop), Constrained query expansion (graph-vocab matching)

### Community 86 - "AGENTS.md/CLAUDE.md D-3/D-4 Duplication"
Cohesion: 0.47
Nodes (6): AGENTS.md D-3: one atomic batch per command (INV-1), AGENTS.md D-4: shared Zod schemas are the single contract, AGENTS.md Playbook: Adding a New Event Type, CLAUDE.md D-3: one atomic batch per command (INV-1), CLAUDE.md D-4: shared Zod schemas are the single contract, CLAUDE.md Playbook: Adding a New Event Type

### Community 87 - "Root Package Scripts"
Cohesion: 0.33
Nodes (6): scripts, build, dev, test, test:e2e, typecheck

### Community 89 - "Client-Side Attack Classes"
Cohesion: 0.08
Nodes (47): conflict(), applyPureTransition(), assertCustomerExists(), assertTransitionAllowed(), buildDeliveryPlan(), cancelOrder(), getOrder(), listOrders() (+39 more)

### Community 90 - "Web Package Metadata"
Cohesion: 0.40
Nodes (4): name, private, type, version

### Community 91 - "Chart Theme Tokens"
Cohesion: 0.40
Nodes (4): chartChrome, ChartMode, chartPalette, chartSemantic

### Community 92 - "Biome JS Formatter Options"
Cohesion: 0.40
Nodes (5): quoteStyle, semicolons, trailingCommas, javascript, formatter

### Community 93 - "HTTP/Auth Protocol Attacks"
Cohesion: 0.40
Nodes (5): HTTP-Protocol and Authentication Hunting, JWT Verification Defects, OAuth / OIDC Flow Defects, Request Smuggling / Desync, SAML Assertion Defects (XSW)

### Community 94 - "Extraction Spec Rules"
Cohesion: 0.40
Nodes (5): Discrete confidence-score rubric (0.55-0.95), Hyperedges for group relationships, Node ID format rule (stem_entity, full path), Semantic similarity edges (semantically_similar_to), Extraction subagent prompt template

### Community 95 - "AGENTS.md/CLAUDE.md D-2 Duplication"
Cohesion: 0.50
Nodes (4): AGENTS.md D-2: writes go through core/ services, AGENTS.md workspace rule: core/ never imports api/telegram/assistant/jobs, CLAUDE.md D-2: writes go through core/ services, CLAUDE.md workspace rule: core/ never imports api/telegram/assistant/jobs

### Community 96 - "AGENTS.md/CLAUDE.md D-5 Duplication"
Cohesion: 0.50
Nodes (4): AGENTS.md D-5: money/qty integers only (INV-6), CLAUDE.md D-5: money/qty integers only (INV-6), items table, Numeric representation rule (INV-6, integer money/qty)

### Community 97 - "Password Hash Script"
Cohesion: 0.67
Nodes (3): hashPassword(), ADR-0007, toBase64Url()

### Community 98 - "Biome Assist Actions"
Cohesion: 0.50
Nodes (4): source, assist, actions, organizeImports

### Community 99 - "Biome VCS Settings"
Cohesion: 0.50
Nodes (4): vcs, clientKind, enabled, useIgnoreFile

### Community 100 - "Design Brand & Tokens"
Cohesion: 0.67
Nodes (4): Design Brief: Kokoro Management, Two browns, split by job (Brand Brown vs UI Ink color model), Design Tokens: Kokoro Management, UI Ink (--primary) token: interactive color as emphasis, not hue

### Community 101 - "AGENTS.md/CLAUDE.md D-10 Duplication"
Cohesion: 0.67
Nodes (3): AGENTS.md D-10: no new dependencies without an ADR note, CLAUDE.md D-10: no new dependencies without an ADR note, toast.tsx (hand-rolled toast primitive, D-10)

### Community 102 - "AGENTS.md/CLAUDE.md Graphify Section"
Cohesion: 0.67
Nodes (3): AGENTS.md graphify section, CLAUDE.md graphify section, Native CLAUDE.md integration (graphify claude install)

### Community 104 - "Dashboard Route Tests"
Cohesion: 0.29
Nodes (6): 1. Scope: CREATE + READ only, 2. `recordSale` now calls `planCostingReplay` (KOK-064), 3. Cost/cash shape, in one paragraph, 4. Fields intentionally left unwired, 5. Where things live, KOK-030 — Sales End-to-End

### Community 106 - "Biome CSS Parser Options"
Cohesion: 0.67
Nodes (3): css, parser, tailwindDirectives

### Community 107 - "Backup Restore Runbook"
Cohesion: 0.67
Nodes (3): Backup Restore Runbook (stub), ADR-015: Worker-proxied backup download (no presigned URLs), KOK-056: full backup restore tooling (not started)

### Community 111 - "src/audit.ts"
Cohesion: 0.12
Nodes (20): G2 Anti-decapitalization (margin at replacement cost), C-5 Margins (margin_wac, margin_replacement, price-health alert), UC-02 Record production run, UC-14 Open/close session, UC-15 Manage catalog & recipes & prices, UC-20 Configure settings, 07 -- Screen Catalog, Onboarding flow (first-run wizard) (+12 more)

### Community 113 - "KOK-034 — Orders board UI"
Cohesion: 0.33
Nodes (5): 1. Scope, 2. The missing piece: resolving a free-text line, 3. Where things live, 4. Also touched, KOK-034 — Orders board UI

### Community 115 - "api/sessions.ts"
Cohesion: 0.15
Nodes (23): fromBase64Url(), timingSafeEqual(), timingSafeEqualString(), toBase64Url(), csrfTokensMatch(), generateCsrfToken(), deriveBits(), hashPassword() (+15 more)

### Community 139 - "production-runs-routes.test.ts"
Cohesion: 0.38
Nodes (9): authHeaders(), createItem(), createProductionRun(), createRecipe(), getCookieValue(), login(), ProductionRunBody, ProductionRunDtoShape (+1 more)

### Community 140 - "src/sales.ts"
Cohesion: 0.29
Nodes (7): usePreviewStockExitImpact(), usePreviewOrderImpact(), usePreviewProductionRunImpact(), usePreviewPurchaseImpact(), usePreviewSaleImpact(), readCookie(), request()

### Community 141 - "src/catalog.ts"
Cohesion: 0.11
Nodes (23): ACTOR, catalogRoute, AddItemAliasCommand, addItemAliasCommandSchema, aliasSchema, CreateItemCommand, createItemCommandSchema, itemNameSchema (+15 more)

### Community 143 - "Security Audit Skill Overview"
Cohesion: 0.17
Nodes (15): Vulnerability Hunting (Phase 2) Doc, Phase 2: Hunt for vulnerabilities, Security Audit Reconnaissance (Phase 1) Doc, Phase 1: Understand the application (Reconnaissance), Security Audit Skill Overview, Defense-in-depth gaps are not vulnerabilities (core principle), Only report what you can exploit (core principle), Severity requires impact (likelihood x impact core principle) (+7 more)

### Community 144 - "production-runs.test.ts"
Cohesion: 0.23
Nodes (8): authRoute, ADR-0007, isLoginRateLimited(), recordFailedLoginAttempt(), rateLimited(), LoginCommand, loginCommandSchema, ADR-0008

### Community 145 - "SalesRoute"
Cohesion: 0.11
Nodes (30): ItemFormParsed, ItemFormValues, CountDetailViewProps, StockTableProps, LineEditorProps, CatalogRow, FixtureItem, StepCountProps (+22 more)

### Community 149 - "SessionDetailDrawer.tsx"
Cohesion: 0.14
Nodes (20): SessionDetailDrawer(), datetimeLocalToIso(), emptyCostLine(), isoToDatetimeLocal(), parseDurationMinutes(), SessionCostLineValue, SessionForm(), sessionToFormState() (+12 more)

### Community 150 - "KOK-033 — Custom-order state machine"
Cohesion: 0.22
Nodes (8): 1. Scope, 2. The free-text-line problem, and why delivery is stricter than quoting, 3. FORFEIT recategorizes; it does not book, 4. `v_receivables` now reports the remainder (migration 0005), 5. The order owns its sale, 6. What KOK-034 must build, 7. Where things live, KOK-033 — Custom-order state machine

### Community 151 - "OrderDto"
Cohesion: 0.15
Nodes (21): CancelOrderDialogProps, ConfirmOrderDialogProps, DeliverOrderDialogProps, OrderBoard(), OrderBoardProps, OrderCard(), OrderCardProps, CANCELLABLE_STATUSES (+13 more)

### Community 152 - "Client-Side and Browser Hunting"
Cohesion: 0.29
Nodes (4): RFC-9562, format(), HEX, RandomSource

### Community 153 - "Memory Safety, Binary, and Kernel Hunting"
Cohesion: 0.40
Nodes (5): Client-Side and Browser Hunting Doc, DOM-based injection attack classes, Prototype pollution attack classes, Client-side trust and messaging attack classes, UI-redress and navigation attack classes

### Community 156 - "updateSaleCommandSchema"
Cohesion: 0.08
Nodes (35): ACCOUNTS_KEY, filtersToQueryString(), RECEIVABLES_KEY, saleDetailKey(), SALES_ROOT_KEY, salesListKey(), useCollectPayment(), useDeleteSale() (+27 more)

### Community 158 - "SessionType"
Cohesion: 0.50
Nodes (4): ImpactConfirmDialogProps, PendingReplayConfirmation, ReplayConfirmationRequiredDetails, ReplayImpactDto

### Community 163 - "api/backups.ts"
Cohesion: 0.09
Nodes (28): BackupRunDetail, backupsRoute, ADR-0015, dashboardRoute, detectWacDrift(), WacDrift, getBalanceConsistencyMismatches(), listAccounts() (+20 more)

## Ambiguous Edges - Review These
- `Wiki export (--wiki)` → `Token reduction benchmark (graphify benchmark)`  [AMBIGUOUS]
  .opencode/skills/graphify/references/exports.md · relation: conceptually_related_to

## Knowledge Gaps
- **801 isolated node(s):** `fs`, `path`, `schemaPath`, `hono-docs`, `$schema` (+796 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **26 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Wiki export (--wiki)` and `Token reduction benchmark (graphify benchmark)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `nowIso()` connect `Finance API Route` to `Inventory Command Services`, `Auth Routes & Audit Log`, `Onboarding & Catalog API`, `Backups & Dashboard API`, `WAC Costing Engine`, `Production Runs API`, `Transaction & Purchase Drawers UI`, `Item Form & Onboarding Steps`, `Count & Exit Forms UI`, `Production Movements & Kardex`, `Costing Routes & Replacement Cost`, `SessionDetailDrawer.tsx`, `Production Run Table UI`, `Crypto Utils & CSRF`, `Event & Count Tables UI`, `Finance API & Schemas`, `api/backups.ts`, `Auth API & Smoke Tests`, `Security Audit Skill Phases`, `Replay Confirmation Hook`, `movements.ts`, `Client-Side Attack Classes`?**
  _High betweenness centrality (0.023) - this node is a cross-community bridge._
- **Why does `Db` connect `movements.ts` to `Inventory Command Services`, `Auth Routes & Audit Log`, `Onboarding & Catalog API`, `api/backups.ts`, `WAC Costing Engine`, `Backups & Dashboard API`, `Finance & Count Dialogs UI`, `Purchasing API & Schemas`, `Transaction & Purchase Drawers UI`, `production-runs.test.ts`, `Item Form & Onboarding Steps`, `SalesRoute`, `Finance API Route`, `Auth API & Smoke Tests`, `Production Movements & Kardex`, `Client-Side Attack Classes`, `Crypto Utils & CSRF`, `Security Audit Skill Phases`?**
  _High betweenness centrality (0.009) - this node is a cross-community bridge._
- **Why does `createDb()` connect `daily-snapshot.ts` to `Inventory Command Services`, `Auth Routes & Audit Log`, `Backups & Dashboard API`, `WAC Costing Engine`, `Finance & Count Dialogs UI`, `production-runs-routes.test.ts`, `src/catalog.ts`, `Transaction & Purchase Drawers UI`, `Sessions Domain Service`, `production-runs.test.ts`, `Item Form & Onboarding Steps`, `Count & Exit Forms UI`, `api/backups.ts`, `Purchasing Route Tests`, `Auth API & Smoke Tests`, `Counts API & Schemas`, `Security Audit Skill Phases`, `Replay Confirmation Hook`, `Recipe Dependency Graph & Domain Errors`, `Exit/Purchase Route Tests`, `Purchasing API & Schemas`, `Production Run Service Tests`, `movements.ts`, `Sessions Route Tests`, `Finance API Route`, `sales/api.ts`, `Client-Side Attack Classes`?**
  _High betweenness centrality (0.009) - this node is a cross-community bridge._
- **What connects `fs`, `path`, `schemaPath` to the rest of the system?**
  _801 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Recipes API & Queries` be split into smaller, more focused modules?**
  _Cohesion score 0.10338680926916222 - nodes in this community are weakly interconnected._
- **Should `Inventory Command Services` be split into smaller, more focused modules?**
  _Cohesion score 0.09358974358974359 - nodes in this community are weakly interconnected._