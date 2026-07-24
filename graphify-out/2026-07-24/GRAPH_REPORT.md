# Graph Report - .  (2026-07-24)

## Corpus Check
- 367 files · ~289,972 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2401 nodes · 6302 edges · 114 communities (103 shown, 11 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 65 edges (avg confidence: 0.78)
- Token cost: 713,534 input · 0 output

## Community Hubs (Navigation)
- Sessions Module UI
- Inventory Queries & Kardex
- Technical Roadmap Phases
- Domain Aggregates & Invariants
- Auth & Rate Limiting
- Costing Adjustments & Dependency Graph
- Detail Drawer Components
- WAC Valuation & Domain Model
- Finance Dialogs & Item Merge UI
- Event/Transaction Tables UI
- Costing Test Fixtures
- Shared Enums
- AI/LLM Attack Classes
- Catalog Aliases & Bulk Import
- Purchase & Recipe DTOs
- Inventory Counts Service
- Recharts API Reference
- Item Form & Detail Drawer
- Worker Package Dependencies
- Production Run Movements & Costs
- AI Assistant Architecture
- Inventory Feature API Hooks
- Module READMEs & Golden Rules
- Line Editor Component
- Item Form Fields
- System Architecture & Cron Jobs
- Stock Exit Service
- Finance Feature API Hooks
- Production Runs API Hooks
- Backups Service & Routes
- Production Run Detail Form
- Web Router Routes
- Finance Accounts Service
- Root Biome/TS Dependencies
- UX/UI Component Catalog
- Dashboard Stat Cards
- Purchases Feature API Hooks
- Onboarding Feature API Hooks
- Recipes API Routes & Schemas
- Catalog Commands & Schemas
- Dashboard Shortcuts & Low Stock
- Recipe Theoretical Cost
- Product Vision Goals
- Use Cases & Reliability Goals
- Shared Package Dependencies
- Base TypeScript Config
- Purchasing API Routes
- Purchasing Costing Logic
- Core Architecture Invariants
- Web TypeScript Config
- shadcn Components Config
- Topbar & Session Fetch
- Inventory Counts Table & Commands
- Playwright CLI Debugging
- Web UI Dependencies
- Web Dev Dependencies
- Worker Scripts Dependencies
- Session Cookie & HMAC
- Recharts Best Practices
- Backup Card UI
- CSRF & Crypto Utils
- Finance DTOs & Test Fixtures
- Security Audit Workflow
- Nav Route Stubs
- Inventory Count Detail View
- Replay Confirmation Mutation Hook
- Skills Lock Include Patterns
- AI/LLM & Access Control Hunting
- Inventory API Routes & Schemas
- Finance Transaction Builders
- Stock Exit Route Tests
- Shared Package TypeScript Config
- Query Client & Auth Handling
- Biome Linter forEach Rule
- Production Run Route Tests
- Root Biome Config
- MCP Server TypeScript Config
- Costing Replay Schemas
- Production Run Route Schemas
- Security Audit Findings Validator
- Worker TypeScript Config
- Toast Notifications
- UUID Generation (RFC-9562)
- Root npm Scripts
- Root package.json Metadata
- Chart Theme Tokens
- Structured Logging Middleware
- Biome Formatter Style
- HTTP Protocol & Auth Hunting
- Password Hash Script
- Biome Assist Actions
- Biome VCS Config
- Client-Side & Browser Hunting
- Design Brief & Tokens
- Catalog Route Tests
- DB Schema Test Expectations
- Tailwind CSS Parser Config
- lucide-react Dependency
- tailwind-merge Dependency
- @types/node Dependency
- typescript Dependency
- Playwright Tracing
- Backups DB Index
- MCP Config
- Web App SPA Entry
- Telegram README

## God Nodes (most connected - your core abstractions)
1. `Db` - 82 edges
2. `nowIso()` - 82 edges
3. `03 -- Domain Model` - 67 edges
4. `10 -- Implementation Backlog` - 64 edges
5. `generateUuidV7()` - 57 edges
6. `validationError()` - 54 edges
7. `notFound()` - 51 edges
8. `buildAuditLogInsert()` - 50 edges
9. `formatMoney()` - 50 edges
10. `cn()` - 48 edges

## Surprising Connections (you probably didn't know these)
- `planCostingReplay()` --implements--> `R-5: confirmation gate for replay impact`  [EXTRACTED]
  apps/worker/src/core/costing/replay.ts → docs/kok-024-event-edit-delete.md
- `KOK-024 Event Edit/Delete Framework` --references--> `useReplayConfirmableMutation()`  [EXTRACTED]
  docs/kok-024-event-edit-delete.md → apps/web/src/hooks/useReplayConfirmableMutation.ts
- `KOK-024 Event Edit/Delete Framework` --references--> `topoOrderAffectedItems()`  [EXTRACTED]
  docs/kok-024-event-edit-delete.md → apps/worker/src/core/costing/dependency-graph.ts
- `KOK-024 Event Edit/Delete Framework` --references--> `planCostingReplay()`  [EXTRACTED]
  docs/kok-024-event-edit-delete.md → apps/worker/src/core/costing/replay.ts
- `Synchronous Replay (WAC correction mechanism)` --implements--> `planCostingReplay()`  [EXTRACTED]
  docs/kok-024-event-edit-delete.md → apps/worker/src/core/costing/replay.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Recharts Chart Component Types** — agents_skills_recharts_references_api_reference_linechart, agents_skills_recharts_references_api_reference_barchart, agents_skills_recharts_references_api_reference_areachart, agents_skills_recharts_references_api_reference_piechart, agents_skills_recharts_references_api_reference_scatterchart, agents_skills_recharts_references_api_reference_composedchart, agents_skills_recharts_references_api_reference_radarchart, agents_skills_recharts_references_api_reference_radialbarchart, agents_skills_recharts_references_api_reference_treemap, agents_skills_recharts_references_api_reference_sankey [EXTRACTED 0.95]
- **Security Audit Six-Phase Workflow** — agents_skills_security_audit_reconnaissance_phase1, agents_skills_security_audit_hunting_phase2, agents_skills_security_audit_validation_and_reporting_phase3, agents_skills_security_audit_validation_and_reporting_phase4, agents_skills_security_audit_validation_and_reporting_phase5, agents_skills_security_audit_validation_and_reporting_phase6 [EXTRACTED 1.00]
- **Kokoro Management Tiered Subagent Roster** — claude_agents_fast_feature_explorer, claude_agents_kb_compliance_reviewer, claude_agents_kb_researcher, claude_agents_quick [INFERRED 0.85]
- **Security Audit Six-Phase Workflow (Recon → Hunt → Validate → Report → Structured Output → Verify)** — claude_skills_security_audit_skill_doc, claude_skills_security_audit_reconnaissance_doc, claude_skills_security_audit_hunting_doc, claude_skills_security_audit_attack_classes_doc, claude_skills_security_audit_validation_and_reporting_doc [EXTRACTED 1.00]
- **Security Audit Domain-Specific Companion Files (Native/Binary, AI/LLM, HTTP-Protocol/Auth, Client-Side)** — claude_skills_security_audit_attack_classes_doc, claude_skills_security_audit_memory_safety_and_binary_doc, claude_skills_security_audit_ai_and_llm_doc, claude_skills_security_audit_web_protocol_and_auth_doc, claude_skills_security_audit_client_side_doc [EXTRACTED 1.00]
- **playwright-cli Skill Reference Document Set** — claude_skills_playwright_cli_skill_doc, claude_skills_playwright_cli_references_element_attributes_doc, claude_skills_playwright_cli_references_playwright_tests_doc, claude_skills_playwright_cli_references_request_mocking_doc, claude_skills_playwright_cli_references_running_code_doc, claude_skills_playwright_cli_references_session_management_doc, claude_skills_playwright_cli_references_storage_state_doc, claude_skills_playwright_cli_references_test_generation_doc, claude_skills_playwright_cli_references_tracing_doc, claude_skills_playwright_cli_references_video_recording_doc [EXTRACTED 1.00]
- **KB Golden Rules (D-1–D-10) Enforcement Across Docs** — claude, github_pull_request_template, apps_worker_src_core_readme, apps_worker_src_db_readme [INFERRED 0.85]
- **CI/CD Pipeline: build, test, migrate, deploy** — github_workflows_ci, github_workflows_deploy, github_workflows_readme, docs_deployment_guide [INFERRED 0.90]
- **WAC Synchronous Replay Correction Mechanism** — docs_kok_024_event_edit_delete_synchronous_replay, apps_worker_src_core_costing_replay_plancostingreplay, docs_kok_024_event_edit_delete_r_4, docs_kok_024_event_edit_delete_r_5, docs_kok_024_event_edit_delete_costing_adjustments, docs_kok_024_event_edit_delete_adr_016 [INFERRED 0.90]
- **Custom order lifecycle: rules, aggregate, table, screen, and use cases** — docs_system_design_knowledge_base_03_domain_model_o_1, docs_system_design_knowledge_base_03_domain_model_o_2, docs_system_design_knowledge_base_03_domain_model_o_3, docs_system_design_knowledge_base_03_domain_model_o_4, docs_system_design_knowledge_base_03_domain_model_o_5, docs_system_design_knowledge_base_03_domain_model_custom_order, docs_system_design_knowledge_base_04_data_model_custom_orders_table, docs_system_design_knowledge_base_07_screen_catalog_sc_04, docs_system_design_knowledge_base_03_domain_model_uc_05, docs_system_design_knowledge_base_03_domain_model_uc_06, docs_system_design_knowledge_base_03_domain_model_uc_07, docs_system_design_knowledge_base_03_domain_model_uc_08 [EXTRACTED 0.90]
- **Backdated WAC replay + cost-adjustment ledger mechanism** — docs_system_design_knowledge_base_03_domain_model_c_1, docs_system_design_knowledge_base_03_domain_model_r_2, docs_system_design_knowledge_base_03_domain_model_r_4, docs_system_design_knowledge_base_03_domain_model_r_5, docs_system_design_knowledge_base_03_domain_model_inv_11, docs_system_design_knowledge_base_12_architecture_decision_records_adr_009, docs_system_design_knowledge_base_12_architecture_decision_records_adr_016, docs_system_design_knowledge_base_04_data_model_costing_adjustments_table [EXTRACTED 0.90]
- **AI CAPTURE pipeline safety rules and confirmation gate** — docs_system_design_knowledge_base_05_ai_assistant_architecture_a_1, docs_system_design_knowledge_base_05_ai_assistant_architecture_a_4, docs_system_design_knowledge_base_05_ai_assistant_architecture_a_5, docs_system_design_knowledge_base_05_ai_assistant_architecture_a_6, docs_system_design_knowledge_base_03_domain_model_inv_4, docs_system_design_knowledge_base_05_ai_assistant_architecture_tool_registry, docs_system_design_knowledge_base_05_ai_assistant_architecture_capture_pipeline [EXTRACTED 0.90]

## Communities (114 total, 11 thin omitted)

### Community 0 - "Sessions Module UI"
Cohesion: 0.05
Nodes (69): SessionChip(), SessionDetailDrawer(), datetimeLocalToIso(), emptyCostLine(), isoToDatetimeLocal(), parseDurationMinutes(), SessionCostLineValue, SessionForm() (+61 more)

### Community 1 - "Inventory Queries & Kardex"
Cohesion: 0.05
Nodes (56): ReplayRow, getStockConsistencyMismatches(), getStockValueTotal(), listKardex(), listStock(), StockMismatchDto, StockMismatchRow, toKardexRowDto() (+48 more)

### Community 2 - "Technical Roadmap Phases"
Cohesion: 0.06
Nodes (65): S-3 PRODUCTION session shared costs allocated proportionally to direct cost, 09 -- Technical Roadmap, Phase 0 -- Foundations, Phase 1 -- Money & Stock Ledger, Phase 2 -- Production & Costing, Phase 3 -- Sales & Custom Orders, Phase 4 -- Telegram + AI Capture, Phase 5 -- Insights & Analytical AI (+57 more)

### Community 3 - "Domain Aggregates & Invariants"
Cohesion: 0.04
Nodes (64): Principle: Deposits are debt, not income, C-3b Recipe theoretical cost (KOK-025 amendment), CustomOrder (aggregate root), DailySnapshot (aggregate root), FinancialTransaction (aggregate root), INV-3 occurred_at (UTC) + business_date (La Paz), INV-7 Custom-order deposit is a liability until delivery, InventoryCount (aggregate root) (+56 more)

### Community 4 - "Auth & Rate Limiting"
Cohesion: 0.05
Nodes (40): ADR-0007, isLoginRateLimited(), recordFailedLoginAttempt(), PendingMovementChange, rateLimited(), getSession(), createDb(), assistantInteractions (+32 more)

### Community 5 - "Costing Adjustments & Dependency Graph"
Cohesion: 0.07
Nodes (49): buildCostingAdjustmentInsert(), CostingAdjustmentEntry, CostingAdjustmentTrigger, Statement, ADR-0016, RecipeEdge, topoOrderAffectedItems(), detectWacDrift() (+41 more)

### Community 6 - "Detail Drawer Components"
Cohesion: 0.08
Nodes (47): DetailDrawer(), DetailDrawerProps, RecordTransactionDialogProps, TransactionsTableProps, TransferDialogProps, WithdrawDialogProps, ExitDetailDrawer(), ExitDetailDrawerProps (+39 more)

### Community 7 - "WAC Valuation & Domain Model"
Cohesion: 0.05
Nodes (57): 03 -- Domain Model, C-1 Weighted average cost (WAC) valuation, C-2 Purchase unit cost = line_total / qty, C-6 Exit valuation at current WAC, Domain events (past-tense, logs/hooks/toasts), Event-sourced-lite modeling stance, INV-10 Deleting an event soft-deletes and reverses derived rows, INV-11 Backdated create/edit/delete triggers synchronous bounded WAC/cost replay (+49 more)

### Community 8 - "Finance Dialogs & Item Merge UI"
Cohesion: 0.10
Nodes (28): MergeItemsDialogProps, AccountCard(), LiabilityReceivableStrip(), RecordTransactionDialog(), TransferDialog(), WithdrawDialog(), CountFormProps, StepBalances() (+20 more)

### Community 9 - "Event/Transaction Tables UI"
Cohesion: 0.12
Nodes (33): EventTable(), EventTableColumn, EventTableProps, TransactionsTable(), CalcTraceStub(), CalcTraceStubProps, CountsTable(), varianceCount() (+25 more)

### Community 10 - "Costing Test Fixtures"
Cohesion: 0.07
Nodes (36): createItem(), itemStock, saleLines, sales, stockMovements, ACTOR, seedItem(), seedMovement() (+28 more)

### Community 11 - "Shared Enums"
Cohesion: 0.05
Nodes (44): ASSISTANT_CHANNELS, ASSISTANT_OUTCOMES, ASSISTANT_PIPELINES, AssistantChannel, assistantChannelSchema, AssistantOutcome, assistantOutcomeSchema, AssistantPipeline (+36 more)

### Community 12 - "AI/LLM Attack Classes"
Cohesion: 0.06
Nodes (45): AI, LLM, and Agent Hunting Doc, Agent and tool-calling attack classes, Output-handling and disclosure attack classes, Prompt-injection attack classes, Attack Classes Doc, Access control attack class, Business logic attack class, Chained attacks and trust boundaries attack class (+37 more)

### Community 13 - "Catalog Aliases & Bulk Import"
Cohesion: 0.14
Nodes (32): ACTOR, AuditEntry, addItemAlias(), removeItemAlias(), bulkCreateItems(), ItemRow, Statement, fetchAliasesForItem() (+24 more)

### Community 14 - "Purchase & Recipe DTOs"
Cohesion: 0.13
Nodes (38): buildAuditLogInsert(), commitPurchaseMutation(), fetchRecipeLines(), getRecipeSettingsDto(), ItemRow, loadItemsById(), RecipeLineRow, RecipeRow (+30 more)

### Community 15 - "Inventory Counts Service"
Cohesion: 0.10
Nodes (34): commitCount(), fetchLines(), findCountRowOrThrow(), getCount(), InventoryCountLineRow, InventoryCountRow, listCounts(), startCount() (+26 more)

### Community 16 - "Recharts API Reference"
Cohesion: 0.10
Nodes (41): Recharts API Reference, AreaChart component, BarChart component, Brush component, CartesianGrid component, Cell component (deprecated, removed in Recharts 4.0), ComposedChart component, Legend component (+33 more)

### Community 17 - "Item Form & Detail Drawer"
Cohesion: 0.11
Nodes (30): CreateItemDialog(), ItemDetailDrawer(), ItemDetailDrawerProps, emptyItemFormValues(), ItemForm(), itemFormValuesFromDto(), parseItemFormValues(), ItemPicker() (+22 more)

### Community 18 - "Worker Package Dependencies"
Cohesion: 0.05
Nodes (39): dependencies, drizzle-orm, hono, @kokoro/shared, zod, devDependencies, @cloudflare/vitest-pool-workers, @cloudflare/workers-types (+31 more)

### Community 19 - "Production Run Movements & Costs"
Cohesion: 0.11
Nodes (35): buildProductionMovementsFromConsumptions(), buildProductionRunCreateInputs(), buildProductionRunDeleteInputs(), buildProductionRunUpdateInputs(), commitProductionRunMutation(), compareKardexRows(), computeProductionCosts(), computeProjectedOutputWac() (+27 more)

### Community 20 - "AI Assistant Architecture"
Cohesion: 0.09
Nodes (39): 05 -- AI Assistant Architecture, A-2 Model never writes SQL, only whitelisted Zod-validated tools, A-3 Every interaction logged to assistant_interactions, A-4 On low confidence, ask one compact clarifying question, A-5 Amount sanity bounds require double-check, CAPTURE pipeline (NL -> draft event -> confirmation -> commit), Draft tool: draft_collect_receivable, Draft tool: draft_expense (+31 more)

### Community 21 - "Inventory Feature API Hooks"
Cohesion: 0.09
Nodes (35): ExitFormProps, countsFiltersToQueryString(), exitsFiltersToQueryString(), INVENTORY_ROOT_KEY, KardexFilters, kardexFiltersToQueryString(), stockFiltersToQueryString(), UpdateCountLineInput (+27 more)

### Community 22 - "Module READMEs & Golden Rules"
Cohesion: 0.09
Nodes (37): assistant/ README, kardexUnchanged / movementSetsEqual guard, core/ README, db/ README, CLAUDE.md — Kokoro Management Development Guide, D-1: The KB is law, D-10: No new dependencies without an ADR note, D-2: All writes go through core/ services (+29 more)

### Community 23 - "Line Editor Component"
Cohesion: 0.11
Nodes (28): LineEditor(), LineEditorLabels, LineEditorLine, LineEditorProps, formatBasisPointsAsPercent(), MarginBadge(), MarginBadgeProps, MarginTone (+20 more)

### Community 24 - "Item Form Fields"
Cohesion: 0.12
Nodes (28): CreateItemDialogProps, ItemFormParsed, ItemFormProps, ItemFormValues, UNIT_ABBREV, ItemPickerProps, ExitsTableProps, CatalogRow (+20 more)

### Community 25 - "System Architecture & Cron Jobs"
Cohesion: 0.08
Nodes (33): 02 -- System Architecture, Cron job: alerts, Cron job: backup, Command flow (any write, any channel), Known gap: Workers Free plan 5-cron-trigger cap blocks deploy-prod (KOK-061), Cron job: daily-snapshot, Event editing flow, Single modular monolith on Cloudflare Workers (+25 more)

### Community 26 - "Stock Exit Service"
Cohesion: 0.14
Nodes (28): getCurrentWac(), buildDeleteExitReplayInput(), buildRecordExitMovement(), buildUpdateExitMovement(), deleteStockExit(), getStockExit(), listStockExits(), loadDeletedExit() (+20 more)

### Community 27 - "Finance Feature API Hooks"
Cohesion: 0.09
Nodes (28): ACCOUNTS_KEY, filtersToQueryString(), TRANSACTIONS_ROOT_KEY, transactionsListKey(), useTransactions(), FinanceRoute(), ACTOR, financeRoute (+20 more)

### Community 28 - "Production Runs API Hooks"
Cohesion: 0.09
Nodes (29): usePreviewStockExitImpact(), filtersToQueryString(), PRODUCTION_RUNS_ROOT_KEY, productionRunDetailKey(), productionRunsListKey(), usePreviewProductionRunImpact(), useProductionRun(), useProductionRuns() (+21 more)

### Community 29 - "Backups Service & Routes"
Cohesion: 0.12
Nodes (20): authRoute, BackupRunDetail, backupsRoute, ADR-0015, catalogRoute, dashboardRoute, errorHandler(), healthRoute (+12 more)

### Community 30 - "Production Run Detail Form"
Cohesion: 0.12
Nodes (26): ProductionRunDetailDrawer(), ProductionRunDetailDrawerProps, emptyLine(), ProductionRunForm(), ProductionRunFormProps, productionRunToFormState(), formatBatches(), formatYieldPct() (+18 more)

### Community 31 - "Web Router Routes"
Cohesion: 0.07
Nodes (28): assistantRoute, authenticatedRoute, financeRoute, inventoryRoute, loginRoute, onboardingRoute, ordersRoute, panelRoute (+20 more)

### Community 32 - "Finance Accounts Service"
Cohesion: 0.12
Nodes (21): assertSafeIntegerInput(), assertValidTransactionAmount(), BalanceMismatchDto, BalanceMismatchRow, buildReplaceTransactionsForSourceStatements(), buildTransactionInsert(), FinancialAccountRow, FinancialTransactionInput (+13 more)

### Community 33 - "Root Biome/TS Dependencies"
Cohesion: 0.07
Nodes (27): @biomejs/biome, description, devDependencies, @biomejs/biome, typescript, devEngines, packageManager, engines (+19 more)

### Community 34 - "UX/UI Component Catalog"
Cohesion: 0.07
Nodes (28): 06 -- UX/UI Specification, Component: AlertsPanel, Component: CalcTrace, Component: ChatPanel, Component: ConfirmDraftCard, Component: CustomerPicker, Component: DateRangePicker, Component: DetailDrawer (+20 more)

### Community 35 - "Dashboard Stat Cards"
Cohesion: 0.11
Nodes (20): StatCard(), StatCardDelta, StatCardProps, AppShell(), MobileBottomTabs(), mobileTabPaths, moreEntries, AppPath (+12 more)

### Community 36 - "Purchases Feature API Hooks"
Cohesion: 0.10
Nodes (25): filtersToQueryString(), purchaseDetailKey(), PURCHASES_ROOT_KEY, purchasesListKey(), readCsrfCookie(), uploadPurchasePhoto(), UploadPurchasePhotoResult, usePurchase() (+17 more)

### Community 37 - "Onboarding Feature API Hooks"
Cohesion: 0.13
Nodes (19): ACCOUNTS_KEY, ITEMS_ROOT_KEY, ONBOARDING_ROOT_KEY, ACTOR, onboardingRoute, setOpeningBalances(), getSetting(), setSetting() (+11 more)

### Community 38 - "Recipes API Routes & Schemas"
Cohesion: 0.09
Nodes (22): ACTOR, recipesRoute, estLaborMinSchema, expectedYieldQtySchema, GetRecipeResult, lineQtySchema, ListRecipesFilters, listRecipesFiltersSchema (+14 more)

### Community 39 - "Catalog Commands & Schemas"
Cohesion: 0.10
Nodes (22): AddItemAliasCommand, addItemAliasCommandSchema, aliasSchema, CreateItemCommand, createItemCommandSchema, itemNameSchema, ListItemsFilters, listItemsFiltersSchema (+14 more)

### Community 40 - "Dashboard Shortcuts & Low Stock"
Cohesion: 0.15
Nodes (16): LowStockStrip(), QuickAddShortcuts(), SHORTCUTS, StockTableProps, useQuickAdd(), useDashboardSummary(), useOnboardingStatus(), dashboardLabels (+8 more)

### Community 41 - "Recipe Theoretical Cost"
Cohesion: 0.17
Nodes (16): buildCostDto(), assertFiniteNonNegative(), assertSafeIntegerInput(), computeRecipeMargin(), computeTheoreticalCostPerOutputUnit(), RecipeCostLine, RecipeMargin, allocateLargestRemainder() (+8 more)

### Community 42 - "Product Vision Goals"
Cohesion: 0.09
Nodes (23): 01 -- Product Vision, G1 Effortless event capture, G2 Anti-decapitalization (margin at replacement cost), G3 Time profitability (Bs/hour), G4 Trustworthy stock, G5 Clean cash, G6 Low cost & maintenance, Principle: AI is observable (+15 more)

### Community 43 - "Use Cases & Reliability Goals"
Cohesion: 0.10
Nodes (23): G7 AI reliability (>=95% draft acceptance), C-4 Production run cost (direct + indirect + allocated session cost), UC-02 Record production run, UC-14 Open/close session, UC-15 Manage catalog & recipes & prices, UC-20 Configure settings, AI evaluation suite (capture + query goldens), 07 -- Screen Catalog (+15 more)

### Community 44 - "Shared Package Dependencies"
Cohesion: 0.09
Nodes (22): dependencies, zod, devDependencies, fast-check, @types/node, typescript, vitest, exports (+14 more)

### Community 45 - "Base TypeScript Config"
Cohesion: 0.09
Nodes (21): compilerOptions, declaration, declarationMap, esModuleInterop, forceConsistentCasingInFileNames, isolatedModules, lib, module (+13 more)

### Community 46 - "Purchasing API Routes"
Cohesion: 0.13
Nodes (19): ACTOR, CONTENT_TYPE_EXTENSIONS, purchasingRoute, buildPurchaseInMovementsFromLines(), buildPurchaseTransactionInputs(), buildPurchaseUpdateMutationInputs(), deletePurchase(), getPurchase() (+11 more)

### Community 47 - "Purchasing Costing Logic"
Cohesion: 0.14
Nodes (20): buildPurchaseDeleteMutationInputs(), compareKardexRows(), computeProjectedWac(), computeReplacementCost(), findLatestOtherPurchaseLineForItem(), isLaterCandidate(), ItemPurchaseState, ItemRow (+12 more)

### Community 48 - "Core Architecture Invariants"
Cohesion: 0.10
Nodes (20): core/ never imports from api/telegram/assistant/jobs dependency rule, INV-1 Every command commits in one atomic batch, INV-6 Money/qty stored as integers, Component: UndoToast, 08 -- AI Development Guide, D-1 The KB is law, D-10 No new dependencies without an ADR note, D-2 All writes go through core/ services (+12 more)

### Community 49 - "Web TypeScript Config"
Cohesion: 0.11
Nodes (18): compilerOptions, jsx, lib, outDir, paths, rootDir, types, extends (+10 more)

### Community 50 - "shadcn Components Config"
Cohesion: 0.11
Nodes (17): aliases, components, hooks, lib, ui, utils, iconLibrary, rsc (+9 more)

### Community 51 - "Topbar & Session Fetch"
Cohesion: 0.14
Nodes (13): Topbar(), fetchSession(), SessionResult, useLogin(), useLogout(), api, authLabels, TODO: migrate into packages/shared/i18n/es.ts once that module exists (KOK-006+) (+5 more)

### Community 52 - "Inventory Counts Table & Commands"
Cohesion: 0.12
Nodes (17): CountsTableProps, businessDateSchema, CommitCountCommand, CommitCountResult, CountAdjustmentDto, countedQtySchema, InventoryCountDto, InventoryCountLineDto (+9 more)

### Community 53 - "Playwright CLI Debugging"
Cohesion: 0.18
Nodes (18): Inspecting Element Attributes, --debug=cli / attach Mechanic, Running and Debugging Playwright Tests, Request Mocking, Running Custom Playwright Code, run-code Command, attach Command (Session Management), Browser Session Management (+10 more)

### Community 54 - "Web UI Dependencies"
Cohesion: 0.12
Nodes (17): dependencies, class-variance-authority, clsx, @kokoro/shared, @radix-ui/react-slot, react, react-dom, @tanstack/react-query (+9 more)

### Community 55 - "Web Dev Dependencies"
Cohesion: 0.12
Nodes (17): devDependencies, @playwright/test, tailwindcss, @tailwindcss/vite, @types/react, @types/react-dom, vite, @vitejs/plugin-react (+9 more)

### Community 56 - "Worker Scripts Dependencies"
Cohesion: 0.12
Nodes (16): dependencies, @kokoro/shared, description, devDependencies, tsx, typescript, @kokoro/shared, typescript (+8 more)

### Community 57 - "Session Cookie & HMAC"
Cohesion: 0.23
Nodes (13): createSessionCookieValue(), importHmacKey(), SessionPayload, ADR-0007, verifySessionCookieValue(), unauthorized(), Bindings, CSRF_EXEMPT_PATHS (+5 more)

### Community 58 - "Recharts Best Practices"
Cohesion: 0.16
Nodes (16): Cell Component (deprecated, use shape prop), Recharts API Reference, ZIndexLayer / Z-Index Layering, accessibilityLayer / Keyboard Navigation, Recharts Best Practices, useMemo/useCallback Memoization Pattern, Recharts Examples, AreaChart Component (+8 more)

### Community 59 - "Backup Card UI"
Cohesion: 0.24
Nodes (10): BackupCard(), formatBytes(), ADR-0015, backupDownloadUrl(), ADR-0015, useBackupStatus(), backupsLabels, TODO: migrate into packages/shared/i18n/es.ts once that module exists (KOK-006+) (+2 more)

### Community 60 - "CSRF & Crypto Utils"
Cohesion: 0.30
Nodes (10): fromBase64Url(), timingSafeEqual(), timingSafeEqualString(), toBase64Url(), csrfTokensMatch(), generateCsrfToken(), deriveBits(), hashPassword() (+2 more)

### Community 61 - "Finance DTOs & Test Fixtures"
Cohesion: 0.20
Nodes (13): FinancialAccountRow, FinancialTransactionRow, financialAccounts, financialTransactions, authHeaders(), createItem(), createPurchase(), CreatePurchaseBody (+5 more)

### Community 62 - "Security Audit Workflow"
Cohesion: 0.17
Nodes (15): Plan → Generate → Heal Workflow, Vulnerability Hunting, Hunting Methodology (12 Attack Angles), Phase 2 Validation Rules, Reconnaissance, Phase 1 Recon Agents (1a/1b/1c), Security Audit Skill Guide, "Only Report What You Can Exploit" Principle (+7 more)

### Community 63 - "Nav Route Stubs"
Cohesion: 0.33
Nodes (6): RouteStub(), navLabels, placeholderLabels, TODO: migrate into packages/shared/i18n/es.ts once that module exists (KOK-006+), AssistantRoute(), PriceHealthRoute()

### Community 64 - "Inventory Count Detail View"
Cohesion: 0.31
Nodes (12): CountDetailView(), CountDetailViewProps, CountForm(), StepCount(), StepCountProps, useCommitCount(), useCount(), useInvalidateInventory() (+4 more)

### Community 65 - "Replay Confirmation Mutation Hook"
Cohesion: 0.21
Nodes (11): ImpactConfirmDialogProps, ConfirmableMutationOutcome, extractReplayConfirmation(), PendingReplayConfirmation, ReplayConfirmationRequiredDetails, runConfirmableMutation(), impact, ADR-0016 (+3 more)

### Community 66 - "Skills Lock Include Patterns"
Cohesion: 0.14
Nodes (14): includes, **, !**/.agents, !**/apps/worker/migrations, !**/.claude, !**/*.d.ts, !**/.design, !**/dist (+6 more)

### Community 67 - "AI/LLM & Access Control Hunting"
Cohesion: 0.15
Nodes (14): AI, LLM, and Agent Hunting, Excessive Agency / Confused-Deputy Authority, Insecure Output Rendering (Model Output XSS), Prompt-Injection Attack Classes, Access Control Attack Class, Business Logic Attack Class, Chained Attacks and Trust Boundaries Class, Attack Classes (+6 more)

### Community 68 - "Inventory API Routes & Schemas"
Cohesion: 0.15
Nodes (12): ACTOR, inventoryRoute, commitCountCommandSchema, listCountsFiltersSchema, startCountCommandSchema, updateCountLineCommandSchema, deleteStockExitCommandSchema, listStockExitsFiltersSchema (+4 more)

### Community 69 - "Finance Transaction Builders"
Cohesion: 0.46
Nodes (11): buildAccountBalanceDelta(), findActiveAccountRowOrThrow(), toAccountDto(), toTransactionDto(), assertLegalCategoryForType(), listTransactions(), recordTransaction(), withdraw() (+3 more)

### Community 70 - "Stock Exit Route Tests"
Cohesion: 0.27
Nodes (12): stockExits, authHeaders(), createExit(), CreateExitBody, createItem(), createPurchase(), CreatePurchaseBody, ExitDtoShape (+4 more)

### Community 71 - "Shared Package TypeScript Config"
Cohesion: 0.15
Nodes (12): compilerOptions, outDir, rootDir, types, extends, include, src, ../../tsconfig.base.json (+4 more)

### Community 72 - "Query Client & Auth Handling"
Cohesion: 0.21
Nodes (8): ToastProvider(), sessionQueryKey, handleUnauthorized(), mutationCache, queryCache, queryClient, rootElement, router

### Community 73 - "Biome Linter forEach Rule"
Cohesion: 0.17
Nodes (12): noForEach, linter, enabled, rules, complexity, preset, style, suspicious (+4 more)

### Community 74 - "Production Run Route Tests"
Cohesion: 0.38
Nodes (9): authHeaders(), createItem(), createProductionRun(), createRecipe(), getCookieValue(), login(), ProductionRunBody, ProductionRunDtoShape (+1 more)

### Community 75 - "Root Biome Config"
Cohesion: 0.22
Nodes (9): files, ignoreUnknown, formatter, enabled, indentStyle, indentWidth, lineWidth, formatter (+1 more)

### Community 76 - "MCP Server TypeScript Config"
Cohesion: 0.20
Nodes (9): compilerOptions, outDir, rootDir, types, extends, include, node, src (+1 more)

### Community 77 - "Costing Replay Schemas"
Cohesion: 0.28
Nodes (7): affectedIdsSchema, confirmFlagSchema, costDeltaSchema, ReplayConfirmationRequiredDetails, replayImpactSchema, emptyImpact, ADR-0016

### Community 78 - "Production Run Route Schemas"
Cohesion: 0.25
Nodes (7): ACTOR, productionRunsRoute, deleteProductionRunCommandSchema, listProductionRunsFiltersSchema, productionRunImpactRequestSchema, recordProductionRunCommandSchema, updateProductionRunCommandSchema

### Community 79 - "Security Audit Findings Validator"
Cohesion: 0.36
Nodes (7): collect(), findDiscriminator(), fs, path, schemaPath, typeOf(), validate()

### Community 80 - "Worker TypeScript Config"
Cohesion: 0.25
Nodes (7): compilerOptions, outDir, rootDir, extends, include, src, ../../tsconfig.base.json

### Community 81 - "Toast Notifications"
Cohesion: 0.33
Nodes (5): ShowToastOptions, ToastCard(), ToastContext, ToastContextValue, ToastItem

### Community 82 - "UUID Generation (RFC-9562)"
Cohesion: 0.29
Nodes (4): RFC-9562, format(), HEX, RandomSource

### Community 83 - "Root npm Scripts"
Cohesion: 0.33
Nodes (6): scripts, build, dev, test, test:e2e, typecheck

### Community 84 - "Root package.json Metadata"
Cohesion: 0.40
Nodes (4): name, private, type, version

### Community 85 - "Chart Theme Tokens"
Cohesion: 0.40
Nodes (4): chartChrome, ChartMode, chartPalette, chartSemantic

### Community 86 - "Structured Logging Middleware"
Cohesion: 0.50
Nodes (4): Bindings, inferSourceChannel(), RequestLogLine, structuredLogging()

### Community 87 - "Biome Formatter Style"
Cohesion: 0.40
Nodes (5): quoteStyle, semicolons, trailingCommas, javascript, formatter

### Community 88 - "HTTP Protocol & Auth Hunting"
Cohesion: 0.40
Nodes (5): HTTP-Protocol and Authentication Hunting, JWT Verification Defects, OAuth / OIDC Flow Defects, Request Smuggling / Desync, SAML Assertion Defects (XSW)

### Community 89 - "Password Hash Script"
Cohesion: 0.67
Nodes (3): hashPassword(), ADR-0007, toBase64Url()

### Community 90 - "Biome Assist Actions"
Cohesion: 0.50
Nodes (4): source, assist, actions, organizeImports

### Community 91 - "Biome VCS Config"
Cohesion: 0.50
Nodes (4): vcs, clientKind, enabled, useIgnoreFile

### Community 92 - "Client-Side & Browser Hunting"
Cohesion: 0.50
Nodes (4): Client-Side and Browser Hunting, DOM-Based XSS, postMessage Origin Trust, Prototype Pollution and Gadget Chain

### Community 93 - "Design Brief & Tokens"
Cohesion: 0.67
Nodes (4): Design Brief: Kokoro Management, Two browns, split by job (Brand Brown vs UI Ink color model), Design Tokens: Kokoro Management, UI Ink (--primary) token: interactive color as emphasis, not hue

### Community 96 - "Tailwind CSS Parser Config"
Cohesion: 0.67
Nodes (3): css, parser, tailwindDirectives

## Ambiguous Edges - Review These
- `ADR-016 Synchronous bounded WAC replay + cost-adjustment ledger (supersedes ADR-009)` → `Explanation: why WAC drifts and is repaired nightly`  [AMBIGUOUS]
  docs/user-guide-ideas.md · relation: conceptually_related_to

## Knowledge Gaps
- **696 isolated node(s):** `fs`, `path`, `schemaPath`, `hono-docs`, `$schema` (+691 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **11 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `ADR-016 Synchronous bounded WAC replay + cost-adjustment ledger (supersedes ADR-009)` and `Explanation: why WAC drifts and is repaired nightly`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `nowIso()` connect `Purchase & Recipe DTOs` to `Sessions Module UI`, `Inventory Queries & Kardex`, `Auth & Rate Limiting`, `Costing Adjustments & Dependency Graph`, `Detail Drawer Components`, `Finance Dialogs & Item Merge UI`, `Event/Transaction Tables UI`, `Costing Test Fixtures`, `Catalog Aliases & Bulk Import`, `Inventory Counts Service`, `Item Form & Detail Drawer`, `Production Run Movements & Costs`, `Stock Exit Service`, `Backups Service & Routes`, `Production Run Detail Form`, `Finance Accounts Service`, `Onboarding Feature API Hooks`, `Purchasing API Routes`, `Purchasing Costing Logic`, `Inventory Count Detail View`, `Finance Transaction Builders`?**
  _High betweenness centrality (0.021) - this node is a cross-community bridge._
- **Why does `Kokoro Management System Design KB (README)` connect `Core Architecture Invariants` to `UX/UI Component Catalog`, `Domain Aggregates & Invariants`, `Technical Roadmap Phases`, `WAC Valuation & Domain Model`, `Product Vision Goals`, `Use Cases & Reliability Goals`, `AI Assistant Architecture`, `System Architecture & Cron Jobs`?**
  _High betweenness centrality (0.014) - this node is a cross-community bridge._
- **Why does `planCostingReplay()` connect `Costing Adjustments & Dependency Graph` to `Inventory Queries & Kardex`, `Auth & Rate Limiting`, `Recipe Theoretical Cost`, `Costing Test Fixtures`, `Purchase & Recipe DTOs`, `Purchasing Costing Logic`, `Production Run Movements & Costs`, `Module READMEs & Golden Rules`, `Stock Exit Service`?**
  _High betweenness centrality (0.010) - this node is a cross-community bridge._
- **What connects `fs`, `path`, `schemaPath` to the rest of the system?**
  _696 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Sessions Module UI` be split into smaller, more focused modules?**
  _Cohesion score 0.05299608551641072 - nodes in this community are weakly interconnected._
- **Should `Inventory Queries & Kardex` be split into smaller, more focused modules?**
  _Cohesion score 0.05267778753292362 - nodes in this community are weakly interconnected._