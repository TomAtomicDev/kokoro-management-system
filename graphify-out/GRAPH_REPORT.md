# Graph Report - kokoro-managemnt-system  (2026-07-24)

## Corpus Check
- 394 files · ~326,612 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2581 nodes · 6580 edges · 139 communities (120 shown, 19 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 63 edges (avg confidence: 0.77)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `f86cf63a`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

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
- graphify reference: extra exports and benchmark
- onboarding.test.ts
- api/backups.ts
- api/recipes.ts
- graphify reference: query, path, explain
- INV-10 Deleting an event soft-deletes and reverses derived rows
- graphify reference: query, path, explain
- ReplayImpactDto
- request
- graphify reference: add a URL and watch a folder
- graphify reference: commit hook and native CLAUDE.md integration
- graphify reference: incremental update and cluster-only
- graphify reference: add a URL and watch a folder
- graphify reference: commit hook and native CLAUDE.md integration
- graphify reference: incremental update and cluster-only
- src/auth.ts
- graphify reference: GitHub clone and cross-repo merge
- graphify reference: transcribe video and audio
- Memory Safety, Binary, and Kernel Hunting
- graphify.js
- graphify reference: GitHub clone and cross-repo merge
- graphify reference: transcribe video and audio
- CLAUDE.md
- .claude/skills/graphify/references/extraction-spec.md
- .opencode/skills/graphify/references/extraction-spec.md

## God Nodes (most connected - your core abstractions)
1. `Db` - 88 edges
2. `nowIso()` - 87 edges
3. `03 -- Domain Model` - 67 edges
4. `10 -- Implementation Backlog` - 64 edges
5. `validationError()` - 58 edges
6. `generateUuidV7()` - 57 edges
7. `notFound()` - 51 edges
8. `buildAuditLogInsert()` - 50 edges
9. `formatMoney()` - 50 edges
10. `cn()` - 48 edges

## Surprising Connections (you probably didn't know these)
- `kb-compliance-reviewer subagent definition` --semantically_similar_to--> `Phase 3: Validate findings`  [INFERRED] [semantically similar]
  .claude/agents/kb-compliance-reviewer.md → .agents/skills/security-audit/VALIDATION-AND-REPORTING.md
- `Verify UI Skill` --semantically_similar_to--> `Deployment Guide`  [INFERRED] [semantically similar]
  .claude/skills/verify-ui/SKILL.md → docs/deployment-guide.md
- `PBKDF2 iteration-count bug (Miniflare vs real workerd)` --semantically_similar_to--> `Workers Best Practices Rules Reference`  [INFERRED] [semantically similar]
  docs/deployment-guide.md → .claude/skills/workers-best-practices/references/rules.md
- `Workspace packages: apps/*, packages/*, tools/*` --semantically_similar_to--> `Single modular monolith on Cloudflare Workers`  [INFERRED] [semantically similar]
  pnpm-workspace.yaml → docs/system-design-knowledge-base/02-system-architecture.md
- `LineEditorProps` --references--> `ItemKind`  [EXTRACTED]
  apps/web/src/components/line-editor/LineEditor.tsx → packages/shared/src/enums.ts

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
- **Custom order lifecycle: rules, aggregate, table, screen, and use cases** — docs_system_design_knowledge_base_03_domain_model_o_1, docs_system_design_knowledge_base_03_domain_model_o_2, docs_system_design_knowledge_base_03_domain_model_o_3, docs_system_design_knowledge_base_03_domain_model_o_4, docs_system_design_knowledge_base_03_domain_model_o_5, docs_system_design_knowledge_base_03_domain_model_custom_order, docs_system_design_knowledge_base_04_data_model_custom_orders_table, docs_system_design_knowledge_base_07_screen_catalog_sc_04, docs_system_design_knowledge_base_03_domain_model_uc_05, docs_system_design_knowledge_base_03_domain_model_uc_06, docs_system_design_knowledge_base_03_domain_model_uc_07, docs_system_design_knowledge_base_03_domain_model_uc_08 [EXTRACTED 0.90]
- **Backdated WAC replay + cost-adjustment ledger mechanism** — docs_system_design_knowledge_base_03_domain_model_c_1, docs_system_design_knowledge_base_03_domain_model_r_2, docs_system_design_knowledge_base_03_domain_model_r_4, docs_system_design_knowledge_base_03_domain_model_r_5, docs_system_design_knowledge_base_03_domain_model_inv_11, docs_system_design_knowledge_base_12_architecture_decision_records_adr_009, docs_system_design_knowledge_base_12_architecture_decision_records_adr_016, docs_system_design_knowledge_base_04_data_model_costing_adjustments_table [EXTRACTED 0.90]
- **AI CAPTURE pipeline safety rules and confirmation gate** — docs_system_design_knowledge_base_05_ai_assistant_architecture_a_1, docs_system_design_knowledge_base_05_ai_assistant_architecture_a_4, docs_system_design_knowledge_base_05_ai_assistant_architecture_a_5, docs_system_design_knowledge_base_05_ai_assistant_architecture_a_6, docs_system_design_knowledge_base_03_domain_model_inv_4, docs_system_design_knowledge_base_05_ai_assistant_architecture_tool_registry, docs_system_design_knowledge_base_05_ai_assistant_architecture_capture_pipeline [EXTRACTED 0.90]

## Communities (139 total, 19 thin omitted)

### Community 0 - "Sessions Module UI"
Cohesion: 0.05
Nodes (64): SessionChip(), SessionDetailDrawer(), SessionDetailDrawerProps, datetimeLocalToIso(), emptyCostLine(), isoToDatetimeLocal(), parseDurationMinutes(), SessionCostLineValue (+56 more)

### Community 1 - "Inventory Queries & Kardex"
Cohesion: 0.11
Nodes (24): detectWacDrift(), getBalanceConsistencyMismatches(), getStockConsistencyMismatches(), getStockValueTotal(), listStock(), buildDailySnapshotUpsert(), buildJobRunInsert(), DailySnapshotValues (+16 more)

### Community 2 - "Technical Roadmap Phases"
Cohesion: 0.06
Nodes (64): S-3 PRODUCTION session shared costs allocated proportionally to direct cost, 09 -- Technical Roadmap, Phase 0 -- Foundations, Phase 1 -- Money & Stock Ledger, Phase 2 -- Production & Costing, Phase 3 -- Sales & Custom Orders, Phase 4 -- Telegram + AI Capture, Phase 5 -- Insights & Analytical AI (+56 more)

### Community 3 - "Domain Aggregates & Invariants"
Cohesion: 0.04
Nodes (63): C-1 Weighted average cost (WAC) valuation, C-3b Recipe theoretical cost (KOK-025 amendment), CustomOrder (aggregate root), DailySnapshot (aggregate root), FinancialTransaction (aggregate root), INV-3 occurred_at (UTC) + business_date (La Paz), InventoryCount (aggregate root), Item (aggregate root) (+55 more)

### Community 4 - "Auth & Rate Limiting"
Cohesion: 0.04
Nodes (83): PendingMovementChange, recordExit(), listWasteSummary(), hasLaterDatedPurchaseForItem(), recordPurchase(), createDb(), assistantInteractions, auditLog (+75 more)

### Community 5 - "Costing Adjustments & Dependency Graph"
Cohesion: 0.07
Nodes (52): buildCostingAdjustmentInsert(), CostingAdjustmentEntry, CostingAdjustmentTrigger, Statement, ADR-0016, RecipeEdge, topoOrderAffectedItems(), assertFiniteNonNegative() (+44 more)

### Community 6 - "Detail Drawer Components"
Cohesion: 0.07
Nodes (52): RecordTransactionDialogProps, TransferDialogProps, WithdrawDialogProps, PurchaseDetailDrawer(), PurchaseDetailDrawerProps, emptyLine(), PurchaseForm(), PurchaseFormProps (+44 more)

### Community 7 - "WAC Valuation & Domain Model"
Cohesion: 0.04
Nodes (66): Principle: Deposits are debt, not income, 03 -- Domain Model, C-2 Purchase unit cost = line_total / qty, C-4 Production run cost (direct + indirect + allocated session cost), C-6 Exit valuation at current WAC, Domain events (past-tense, logs/hooks/toasts), Event-sourced-lite modeling stance, INV-11 Backdated create/edit/delete triggers synchronous bounded WAC/cost replay (+58 more)

### Community 8 - "Finance Dialogs & Item Merge UI"
Cohesion: 0.07
Nodes (41): AccountCard(), LiabilityReceivableStrip(), RecordTransactionDialog(), TransferDialog(), WithdrawDialog(), CountFormProps, exitFormInitialState, ExitFormProps (+33 more)

### Community 9 - "Event/Transaction Tables UI"
Cohesion: 0.10
Nodes (30): CalcTrace(), CalcTraceProps, EventTable(), EventTableColumn, EventTableProps, TransactionsTable(), CountsTable(), varianceCount() (+22 more)

### Community 10 - "Costing Test Fixtures"
Cohesion: 0.33
Nodes (5): ACTOR, seedItem(), seedMovement(), TestDb, ADR-0016

### Community 11 - "Shared Enums"
Cohesion: 0.05
Nodes (40): ASSISTANT_CHANNELS, ASSISTANT_OUTCOMES, ASSISTANT_PIPELINES, AssistantChannel, assistantChannelSchema, AssistantOutcome, assistantOutcomeSchema, AssistantPipeline (+32 more)

### Community 12 - "AI/LLM Attack Classes"
Cohesion: 0.06
Nodes (45): AI, LLM, and Agent Hunting Doc, Agent and tool-calling attack classes, Output-handling and disclosure attack classes, Prompt-injection attack classes, Attack Classes Doc, Access control attack class, Business logic attack class, Chained attacks and trust boundaries attack class (+37 more)

### Community 13 - "Catalog Aliases & Bulk Import"
Cohesion: 0.15
Nodes (35): isLoginRateLimited(), recordFailedLoginAttempt(), AuditEntry, buildAuditLogInsert(), addItemAlias(), removeItemAlias(), bulkCreateItems(), ItemRow (+27 more)

### Community 14 - "Purchase & Recipe DTOs"
Cohesion: 0.29
Nodes (16): fetchRecipeLines(), getRecipeSettingsDto(), toRecipeDto(), buildClearOtherDefaultsStatement(), getRecipe(), listRecipes(), RecipeLineRow, RecipeRow (+8 more)

### Community 15 - "Inventory Counts Service"
Cohesion: 0.08
Nodes (52): getCurrentWac(), ADR-0016, WacDrift, conflict(), DOMAIN_ERROR_CODES, DOMAIN_ERROR_HTTP_STATUS, DomainErrorCode, DomainHttpStatus (+44 more)

### Community 16 - "Recharts API Reference"
Cohesion: 0.10
Nodes (41): Recharts API Reference, AreaChart component, BarChart component, Brush component, CartesianGrid component, Cell component (deprecated, removed in Recharts 4.0), ComposedChart component, Legend component (+33 more)

### Community 17 - "Item Form & Detail Drawer"
Cohesion: 0.07
Nodes (49): CreateItemDialog(), ItemDetailDrawer(), ItemDetailDrawerProps, emptyItemFormValues(), ItemForm(), ItemFormProps, itemFormValuesFromDto(), parseItemFormValues() (+41 more)

### Community 18 - "Worker Package Dependencies"
Cohesion: 0.05
Nodes (39): dependencies, drizzle-orm, hono, @kokoro/shared, zod, devDependencies, @cloudflare/vitest-pool-workers, @cloudflare/workers-types (+31 more)

### Community 19 - "Production Run Movements & Costs"
Cohesion: 0.16
Nodes (25): buildProductionMovementsFromConsumptions(), buildProductionRunCreateInputs(), buildProductionRunDeleteInputs(), buildProductionRunUpdateInputs(), commitProductionRunMutation(), compareKardexRows(), computeProductionCosts(), computeProjectedItemWacAcrossRuns() (+17 more)

### Community 20 - "AI Assistant Architecture"
Cohesion: 0.09
Nodes (39): 05 -- AI Assistant Architecture, A-2 Model never writes SQL, only whitelisted Zod-validated tools, A-3 Every interaction logged to assistant_interactions, A-4 On low confidence, ask one compact clarifying question, A-5 Amount sanity bounds require double-check, CAPTURE pipeline (NL -> draft event -> confirmation -> commit), Draft tool: draft_collect_receivable, Draft tool: draft_expense (+31 more)

### Community 21 - "Inventory Feature API Hooks"
Cohesion: 0.09
Nodes (32): countsFiltersToQueryString(), exitsFiltersToQueryString(), INVENTORY_ROOT_KEY, KardexFilters, kardexFiltersToQueryString(), stockFiltersToQueryString(), UpdateCountLineInput, useCounts() (+24 more)

### Community 22 - "Module READMEs & Golden Rules"
Cohesion: 0.12
Nodes (28): assistant/ README, core/ README, db/ README, CLAUDE.md — Kokoro Management Development Guide, D-1: The KB is law, D-10: No new dependencies without an ADR note, D-2: All writes go through core/ services, D-3: One atomic batch per command (+20 more)

### Community 23 - "Line Editor Component"
Cohesion: 0.08
Nodes (51): CalcTraceInput, ExitsTable(), WasteSummaryCard(), LineEditor(), LineEditorLabels, LineEditorLine, LineEditorProps, ProductionRunDetailDrawer() (+43 more)

### Community 24 - "Item Form Fields"
Cohesion: 0.11
Nodes (35): CreateItemDialogProps, ItemFormParsed, ItemFormValues, ItemPickerProps, CountDetailView(), CountDetailViewProps, StockTableProps, CatalogRow (+27 more)

### Community 25 - "System Architecture & Cron Jobs"
Cohesion: 0.07
Nodes (36): 02 -- System Architecture, Cron job: alerts, Cron job: backup, Command flow (any write, any channel), Known gap: Workers Free plan 5-cron-trigger cap blocks deploy-prod (KOK-061), Cron job: daily-snapshot, Event editing flow, Single modular monolith on Cloudflare Workers (+28 more)

### Community 26 - "Stock Exit Service"
Cohesion: 0.11
Nodes (25): assertClosableDuration(), assertCostLinesValid(), assertNoLiveLinkedEvents(), buildSessionCostTransactionInput(), checkOpenSessionWarning(), getSession(), listSessions(), loadSessionForMutation() (+17 more)

### Community 27 - "Finance Feature API Hooks"
Cohesion: 0.08
Nodes (27): TransactionsTableProps, isInflow(), signedTransactionAmount(), transactionAmountColorClass(), ACTOR, financeRoute, financialTransactionCategorySchema, FinancialTransactionType (+19 more)

### Community 28 - "Production Runs API Hooks"
Cohesion: 0.09
Nodes (28): ProductionRunFormProps, filtersToQueryString(), PRODUCTION_RUNS_ROOT_KEY, productionRunDetailKey(), productionRunsListKey(), useProductionRun(), useProductionRuns(), SessionCostAllocationResult (+20 more)

### Community 29 - "Backups Service & Routes"
Cohesion: 0.11
Nodes (24): authRoute, ADR-0007, costingRoute, dashboardRoute, errorHandler(), healthRoute, productionRunsRoute, DomainError (+16 more)

### Community 30 - "Production Run Detail Form"
Cohesion: 0.07
Nodes (26): For /graphify add and --watch, For /graphify query, For the commit hook and native CLAUDE.md integration, For --update and --cluster-only, /graphify, Honesty Rules, Interpreter guard for subcommands, Part A - Structural extraction for code files (+18 more)

### Community 31 - "Web Router Routes"
Cohesion: 0.07
Nodes (29): fetchSession(), assistantRoute, authenticatedRoute, financeRoute, inventoryRoute, loginRoute, onboardingRoute, ordersRoute (+21 more)

### Community 32 - "Finance Accounts Service"
Cohesion: 0.12
Nodes (34): assertSafeIntegerInput(), assertValidTransactionAmount(), BalanceMismatchDto, BalanceMismatchRow, buildAccountBalanceDelta(), buildReplaceTransactionsForSourceStatements(), buildTransactionInsert(), FinancialAccountRow (+26 more)

### Community 33 - "Root Biome/TS Dependencies"
Cohesion: 0.07
Nodes (27): @biomejs/biome, description, devDependencies, @biomejs/biome, typescript, devEngines, packageManager, engines (+19 more)

### Community 34 - "UX/UI Component Catalog"
Cohesion: 0.07
Nodes (30): Principle: Replacement cost is the truth in inflation, C-3 Replacement cost (last purchase by business_date), 06 -- UX/UI Specification, Component: AlertsPanel, Component: CalcTrace, Component: ChatPanel, Component: ConfirmDraftCard, Component: CustomerPicker (+22 more)

### Community 35 - "Dashboard Stat Cards"
Cohesion: 0.14
Nodes (16): AppShell(), MobileBottomTabs(), mobileTabPaths, moreEntries, footerNav, mobileTabs, NavActionItem, NavDivider (+8 more)

### Community 36 - "Purchases Feature API Hooks"
Cohesion: 0.08
Nodes (24): For /graphify add and --watch, For /graphify query, For the commit hook and native CLAUDE.md integration, For --update and --cluster-only, /graphify, Honesty Rules, Interpreter guard for subcommands, Part A - Structural extraction for code files (+16 more)

### Community 37 - "Onboarding Feature API Hooks"
Cohesion: 0.12
Nodes (19): ACCOUNTS_KEY, ITEMS_ROOT_KEY, ONBOARDING_ROOT_KEY, ACTOR, catalogRoute, ACTOR, onboardingRoute, createItemCommandSchema (+11 more)

### Community 38 - "Recipes API Routes & Schemas"
Cohesion: 0.11
Nodes (23): filtersToQueryString(), recipeDetailKey(), RECIPES_ROOT_KEY, recipesListKey(), useInvalidateRecipes(), useRecipeQuery(), useRecordRecipe(), useUpdateRecipe() (+15 more)

### Community 39 - "Catalog Commands & Schemas"
Cohesion: 0.14
Nodes (17): RecipeFormProps, buildCostDto(), ItemRow, loadItemsById(), RecipeLineRow, RecipeRow, toRecipeLineDto(), assertFiniteNonNegative() (+9 more)

### Community 40 - "Dashboard Shortcuts & Low Stock"
Cohesion: 0.14
Nodes (16): LowStockStrip(), QuickAddShortcuts(), SHORTCUTS, StatCard(), StatCardDelta, StatCardProps, AppPath, useQuickAdd() (+8 more)

### Community 41 - "Recipe Theoretical Cost"
Cohesion: 0.32
Nodes (9): allocateLargestRemainder(), BasisPoints, mulMoneyByBasisPoints(), mulMoneyByQty(), roundHalfUpToInt(), ADR-0011, assertSafeInteger(), groupThousands() (+1 more)

### Community 42 - "Product Vision Goals"
Cohesion: 0.09
Nodes (25): 01 -- Product Vision, G1 Effortless event capture, G2 Anti-decapitalization (margin at replacement cost), G3 Time profitability (Bs/hour), G4 Trustworthy stock, G5 Clean cash, G6 Low cost & maintenance, G7 AI reliability (>=95% draft acceptance) (+17 more)

### Community 43 - "Use Cases & Reliability Goals"
Cohesion: 0.16
Nodes (16): KardexViewRow, listKardex(), StockMismatchDto, StockMismatchRow, toKardexRowDto(), toStockRowDto(), ADR-0016, StockMovementType (+8 more)

### Community 44 - "Shared Package Dependencies"
Cohesion: 0.09
Nodes (22): dependencies, zod, devDependencies, fast-check, @types/node, typescript, vitest, exports (+14 more)

### Community 45 - "Base TypeScript Config"
Cohesion: 0.09
Nodes (21): compilerOptions, declaration, declarationMap, esModuleInterop, forceConsistentCasingInFileNames, isolatedModules, lib, module (+13 more)

### Community 46 - "Purchasing API Routes"
Cohesion: 0.10
Nodes (26): ACTOR, CONTENT_TYPE_EXTENSIONS, purchasingRoute, BACKUP_TABLES, dumpTable(), runBackup(), serializeSqlValue(), TableDump (+18 more)

### Community 47 - "Purchasing Costing Logic"
Cohesion: 0.09
Nodes (38): buildPurchaseDeleteMutationInputs(), buildPurchaseInMovementsFromLines(), buildPurchaseTransactionInputs(), buildPurchaseUpdateMutationInputs(), commitPurchaseMutation(), compareKardexRows(), computeProjectedWac(), computeReplacementCost() (+30 more)

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
Cohesion: 0.36
Nodes (5): Topbar(), useLogout(), authLabels, TODO: migrate into packages/shared/i18n/es.ts once that module exists (KOK-006+), topbarLabels

### Community 52 - "Inventory Counts Table & Commands"
Cohesion: 0.12
Nodes (17): CountsTableProps, businessDateSchema, CommitCountCommand, CommitCountResult, CountAdjustmentDto, countedQtySchema, InventoryCountDto, ListCountsFilters (+9 more)

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
Cohesion: 0.15
Nodes (23): fromBase64Url(), timingSafeEqual(), timingSafeEqualString(), toBase64Url(), csrfTokensMatch(), generateCsrfToken(), deriveBits(), hashPassword() (+15 more)

### Community 58 - "Recharts Best Practices"
Cohesion: 0.16
Nodes (16): Cell Component (deprecated, use shape prop), Recharts API Reference, ZIndexLayer / Z-Index Layering, accessibilityLayer / Keyboard Navigation, Recharts Best Practices, useMemo/useCallback Memoization Pattern, Recharts Examples, AreaChart Component (+8 more)

### Community 59 - "Backup Card UI"
Cohesion: 0.26
Nodes (9): BackupCard(), formatBytes(), ADR-0015, backupDownloadUrl(), useBackupStatus(), backupsLabels, TODO: migrate into packages/shared/i18n/es.ts once that module exists (KOK-006+), SettingsBackupsRoute() (+1 more)

### Community 60 - "CSRF & Crypto Utils"
Cohesion: 0.17
Nodes (9): recipes, getCookieValue(), login(), ACTOR, seedDefaultRecipe(), seedItem(), Statement, TestDb (+1 more)

### Community 61 - "Finance DTOs & Test Fixtures"
Cohesion: 0.33
Nodes (9): authHeaders(), createItem(), createPurchase(), CreatePurchaseBody, getCookieValue(), login(), PurchaseDtoShape, PurchaseLineBody (+1 more)

### Community 62 - "Security Audit Workflow"
Cohesion: 0.17
Nodes (15): Plan → Generate → Heal Workflow, Vulnerability Hunting, Hunting Methodology (12 Attack Angles), Phase 2 Validation Rules, Reconnaissance, Phase 1 Recon Agents (1a/1b/1c), Security Audit Skill Guide, "Only Report What You Can Exploit" Principle (+7 more)

### Community 63 - "Nav Route Stubs"
Cohesion: 0.33
Nodes (6): RouteStub(), navLabels, placeholderLabels, TODO: migrate into packages/shared/i18n/es.ts once that module exists (KOK-006+), AssistantRoute(), PriceHealthRoute()

### Community 64 - "Inventory Count Detail View"
Cohesion: 0.18
Nodes (10): 1. What this task actually covers, 2. The core mechanism: synchronous replay, 3. R-4: never rewrite history, book it forward instead, 4. Why edit/delete cost changed from O(1) to O(n), 5. Restore (undo) is a mutation, not a snapshot, 6. The "descriptive-only edit" optimization — and where it's missing, 7. Other decisions worth knowing, 8. What's deferred / not done (+2 more)

### Community 65 - "Replay Confirmation Mutation Hook"
Cohesion: 0.31
Nodes (6): ConfirmableMutationOutcome, extractReplayConfirmation(), runConfirmableMutation(), impact, ADR-0016, UseReplayConfirmableMutationOptions

### Community 66 - "Skills Lock Include Patterns"
Cohesion: 0.14
Nodes (14): includes, **, !**/.agents, !**/apps/worker/migrations, !**/.claude, !**/*.d.ts, !**/.design, !**/dist (+6 more)

### Community 67 - "AI/LLM & Access Control Hunting"
Cohesion: 0.20
Nodes (11): AI, LLM, and Agent Hunting, Excessive Agency / Confused-Deputy Authority, Insecure Output Rendering (Model Output XSS), Prompt-Injection Attack Classes, Access Control Attack Class, Business Logic Attack Class, Chained Attacks and Trust Boundaries Class, Attack Classes (+3 more)

### Community 68 - "Inventory API Routes & Schemas"
Cohesion: 0.15
Nodes (12): ACTOR, inventoryRoute, commitCountCommandSchema, listCountsFiltersSchema, startCountCommandSchema, updateCountLineCommandSchema, deleteStockExitCommandSchema, listStockExitsFiltersSchema (+4 more)

### Community 69 - "Finance Transaction Builders"
Cohesion: 0.22
Nodes (8): CLAUDE.md — Kokoro Management Development Guide, Definition of Done, Golden Rules, graphify, Guardrails for AI Agents, Playbook: Adding a New Event Type, Repository Conventions, Where Things Live

### Community 70 - "Stock Exit Route Tests"
Cohesion: 0.30
Nodes (11): authHeaders(), createExit(), CreateExitBody, createItem(), createPurchase(), CreatePurchaseBody, ExitDtoShape, getCookieValue() (+3 more)

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
Cohesion: 0.24
Nodes (8): affectedIdsSchema, confirmFlagSchema, costDeltaSchema, ReplacementCostRefreshResultDto, ReplayConfirmationRequiredDetails, replayImpactSchema, emptyImpact, ADR-0016

### Community 78 - "Production Run Route Schemas"
Cohesion: 0.13
Nodes (18): ACTOR, getProductionRun(), listProductionRuns(), loadProductionRunForRestore(), recordProductionRun(), restoreProductionRun(), toProductionRunDto(), productionRuns (+10 more)

### Community 79 - "Security Audit Findings Validator"
Cohesion: 0.36
Nodes (7): collect(), findDiscriminator(), fs, path, schemaPath, typeOf(), validate()

### Community 80 - "Worker TypeScript Config"
Cohesion: 0.25
Nodes (7): compilerOptions, outDir, rootDir, extends, include, src, ../../tsconfig.base.json

### Community 81 - "Toast Notifications"
Cohesion: 0.13
Nodes (21): CountForm(), ExitDetailDrawer(), ExitDetailDrawerProps, errorMessage(), ExitForm(), ShowToastOptions, ToastCard(), ToastContext (+13 more)

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
Cohesion: 0.22
Nodes (8): graphify reference: extra exports and benchmark, Step 6b - Wiki (only if --wiki flag), Step 7 - Neo4j export (only if --neo4j or --neo4j-push flag), Step 7a - FalkorDB export (only if --falkordb or --falkordb-push flag), Step 7b - SVG export (only if --svg flag), Step 7c - GraphML export (only if --graphml flag), Step 7d - MCP server (only if --mcp flag), Step 8 - Token reduction benchmark (only if total_words > 5000)

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

### Community 114 - "graphify reference: extra exports and benchmark"
Cohesion: 0.22
Nodes (8): graphify reference: extra exports and benchmark, Step 6b - Wiki (only if --wiki flag), Step 7 - Neo4j export (only if --neo4j or --neo4j-push flag), Step 7a - FalkorDB export (only if --falkordb or --falkordb-push flag), Step 7b - SVG export (only if --svg flag), Step 7c - GraphML export (only if --graphml flag), Step 7d - MCP server (only if --mcp flag), Step 8 - Token reduction benchmark (only if total_words > 5000)

### Community 115 - "onboarding.test.ts"
Cohesion: 0.36
Nodes (5): getSetting(), setSetting(), appSettings, ACTOR, TestDb

### Community 116 - "api/backups.ts"
Cohesion: 0.29
Nodes (4): BackupRunDetail, backupsRoute, ADR-0015, BackupStatusDto

### Community 117 - "api/recipes.ts"
Cohesion: 0.29
Nodes (6): ACTOR, recipesRoute, listRecipesFiltersSchema, recordRecipeCommandSchema, setRecipeActiveCommandSchema, updateRecipeCommandSchema

### Community 118 - "graphify reference: query, path, explain"
Cohesion: 0.33
Nodes (5): For /graphify explain, For /graphify path, graphify reference: query, path, explain, Step 0 — Constrained query expansion (REQUIRED before traversal), Step 1 — Traversal

### Community 119 - "INV-10 Deleting an event soft-deletes and reverses derived rows"
Cohesion: 0.40
Nodes (6): INV-10 Deleting an event soft-deletes and reverses derived rows, INV-5 item_stock/balances must equal derived sums (nightly check), INV-9 Derived rows carry source_event_type/id; no orphans, D-8 Soft delete only for business events, Property-based tests (mandatory for money math), ADR-009 Editable events with system-derived kardex; O(1) edits + nightly WAC repair

### Community 120 - "graphify reference: query, path, explain"
Cohesion: 0.33
Nodes (5): For /graphify explain, For /graphify path, graphify reference: query, path, explain, Step 0 — Constrained query expansion (REQUIRED before traversal), Step 1 — Traversal

### Community 121 - "ReplayImpactDto"
Cohesion: 0.40
Nodes (5): ImpactConfirmDialogProps, PendingReplayConfirmation, ReplayConfirmationRequiredDetails, CostingReplayPlan, ReplayImpactDto

### Community 122 - "request"
Cohesion: 0.40
Nodes (5): usePreviewStockExitImpact(), usePreviewProductionRunImpact(), usePreviewPurchaseImpact(), readCookie(), request()

### Community 123 - "graphify reference: add a URL and watch a folder"
Cohesion: 0.50
Nodes (3): For /graphify add, For --watch, graphify reference: add a URL and watch a folder

### Community 124 - "graphify reference: commit hook and native CLAUDE.md integration"
Cohesion: 0.50
Nodes (3): For git commit hook, For native CLAUDE.md integration, graphify reference: commit hook and native CLAUDE.md integration

### Community 125 - "graphify reference: incremental update and cluster-only"
Cohesion: 0.50
Nodes (3): For --cluster-only, For --update (incremental re-extraction), graphify reference: incremental update and cluster-only

### Community 126 - "graphify reference: add a URL and watch a folder"
Cohesion: 0.50
Nodes (3): For /graphify add, For --watch, graphify reference: add a URL and watch a folder

### Community 127 - "graphify reference: commit hook and native CLAUDE.md integration"
Cohesion: 0.50
Nodes (3): For git commit hook, For native CLAUDE.md integration, graphify reference: commit hook and native CLAUDE.md integration

### Community 128 - "graphify reference: incremental update and cluster-only"
Cohesion: 0.50
Nodes (3): For --cluster-only, For --update (incremental re-extraction), graphify reference: incremental update and cluster-only

### Community 129 - "src/auth.ts"
Cohesion: 0.50
Nodes (3): LoginCommand, loginCommandSchema, ADR-0008

### Community 132 - "Memory Safety, Binary, and Kernel Hunting"
Cohesion: 0.67
Nodes (3): Memory Safety, Binary, and Kernel Hunting, Spatial OOB Read/Write Bugs, Temporal Use-After-Free / Lifetime Bugs

## Knowledge Gaps
- **802 isolated node(s):** `fs`, `path`, `schemaPath`, `hono-docs`, `$schema` (+797 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **19 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `nowIso()` connect `Catalog Aliases & Bulk Import` to `Sessions Module UI`, `Finance Accounts Service`, `Inventory Queries & Kardex`, `Onboarding Feature API Hooks`, `Detail Drawer Components`, `Costing Adjustments & Dependency Graph`, `Finance Dialogs & Item Merge UI`, `Event/Transaction Tables UI`, `Production Run Route Schemas`, `Inventory Counts Service`, `Purchasing Costing Logic`, `Purchase & Recipe DTOs`, `Purchasing API Routes`, `Production Run Movements & Costs`, `Line Editor Component`, `Item Form Fields`, `Stock Exit Service`, `Backups Service & Routes`?**
  _High betweenness centrality (0.013) - this node is a cross-community bridge._
- **Why does `Kokoro Management System Design KB (README)` connect `Core Architecture Invariants` to `UX/UI Component Catalog`, `Domain Aggregates & Invariants`, `Technical Roadmap Phases`, `WAC Valuation & Domain Model`, `Product Vision Goals`, `AI Assistant Architecture`, `System Architecture & Cron Jobs`?**
  _High betweenness centrality (0.012) - this node is a cross-community bridge._
- **Why does `Db` connect `Catalog Aliases & Bulk Import` to `Finance Accounts Service`, `Inventory Queries & Kardex`, `Auth & Rate Limiting`, `Costing Adjustments & Dependency Graph`, `Catalog Commands & Schemas`, `Use Cases & Reliability Goals`, `Production Run Route Schemas`, `Inventory Counts Service`, `Purchasing Costing Logic`, `Purchase & Recipe DTOs`, `Purchasing API Routes`, `Production Run Movements & Costs`, `onboarding.test.ts`, `Stock Exit Service`?**
  _High betweenness centrality (0.009) - this node is a cross-community bridge._
- **What connects `fs`, `path`, `schemaPath` to the rest of the system?**
  _802 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Sessions Module UI` be split into smaller, more focused modules?**
  _Cohesion score 0.05368421052631579 - nodes in this community are weakly interconnected._
- **Should `Inventory Queries & Kardex` be split into smaller, more focused modules?**
  _Cohesion score 0.11182795698924732 - nodes in this community are weakly interconnected._
- **Should `Technical Roadmap Phases` be split into smaller, more focused modules?**
  _Cohesion score 0.0625 - nodes in this community are weakly interconnected._