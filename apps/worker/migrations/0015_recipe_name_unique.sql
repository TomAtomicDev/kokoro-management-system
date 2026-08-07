-- KOK-025 KB amendment: recipe names must be unique among ACTIVE recipes (Doc 03 "Recipe" row,
-- Doc 04 §3.1) — closes a duplicate-recipe bug where recordRecipe had no name-conflict guard.
--
-- Pre-repair step: onboarding's StepRecipes.tsx could double-submit the 3 starter recipes on a
-- step remount (KOK-020), and recordRecipe never rejected the resulting duplicate name/output —
-- so an environment may already hold two+ ACTIVE recipes sharing a name. Deactivate every extra
-- one before creating the unique index below, or the index creation itself would fail on the
-- existing collision. Keeps, per name: the current `is_default` row if any, else the oldest
-- (`created_at`) row, else the lowest `id` as a final deterministic tiebreak — never data-lossy,
-- since deactivation is the same soft-delete `setRecipeActive` already performs (D-8).
UPDATE recipes
SET is_active = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE is_active = 1
  AND id NOT IN (
    SELECT id FROM (
      SELECT id, ROW_NUMBER() OVER (
        PARTITION BY name
        ORDER BY is_default DESC, created_at ASC, id ASC
      ) AS rn
      FROM recipes
      WHERE is_active = 1
    )
    WHERE rn = 1
  );
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_recipes_name` ON `recipes` (`name`) WHERE "recipes"."is_active" = 1;