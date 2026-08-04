// Onboarding step 4 (KOK-020, Doc 07 step 4) — creates the optional starter recipes from the
// catalog items that are actually present after step 3.

import type { ItemDto, RecipeLineCommand, RecordRecipeCommand } from "@kokoro/shared";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { useRecordRecipe } from "@/features/recipes/api";
import { ApiError } from "@/lib/api";
import { onboardingLabels } from "@/lib/i18n-onboarding";

const STARTER_ITEM_NAMES = [
  "Harina",
  "Agua",
  "Sal",
  "Masa madre refrigerada",
  "Masa madre activada",
  "Pan blanco pequeño",
] as const;

type StarterItemName = (typeof STARTER_ITEM_NAMES)[number];

interface StarterRecipeLine {
  itemName: StarterItemName;
  qty: number;
}

interface StarterRecipe {
  name: string;
  outputItemName: StarterItemName;
  expectedYieldQty: number;
  outputPreview: string;
  lines: readonly StarterRecipeLine[];
}

const STARTER_RECIPES: readonly StarterRecipe[] = [
  {
    name: "Alimentar masa madre",
    outputItemName: "Masa madre refrigerada",
    expectedYieldQty: 200000,
    outputPreview: "Masa madre refrigerada · 200 g",
    lines: [
      { itemName: "Harina", qty: 100 },
      { itemName: "Agua", qty: 100 },
    ],
  },
  {
    name: "Activar masa madre",
    outputItemName: "Masa madre activada",
    expectedYieldQty: 700000,
    outputPreview: "Masa madre activada · 700 g",
    lines: [
      { itemName: "Masa madre refrigerada", qty: 150000 },
      { itemName: "Harina", qty: 300 },
      { itemName: "Agua", qty: 300 },
    ],
  },
  {
    name: "Pan blanco pequeño",
    outputItemName: "Pan blanco pequeño",
    expectedYieldQty: 4000,
    outputPreview: "Pan blanco pequeño · 4 u",
    lines: [
      { itemName: "Harina", qty: 580 },
      { itemName: "Masa madre activada", qty: 150000 },
      { itemName: "Agua", qty: 345 },
      { itemName: "Sal", qty: 2000 },
    ],
  },
];

function resolveRecipeCommand(
  recipe: StarterRecipe,
  itemsByName: ReadonlyMap<string, ItemDto>,
): RecordRecipeCommand | null {
  const outputItem = itemsByName.get(recipe.outputItemName);
  if (!outputItem) return null;

  const lines: RecipeLineCommand[] = [];
  for (const line of recipe.lines) {
    const item = itemsByName.get(line.itemName);
    if (!item) return null;
    lines.push({ itemId: item.id, qty: line.qty });
  }

  return {
    name: recipe.name,
    outputItemId: outputItem.id,
    expectedYieldQty: recipe.expectedYieldQty,
    estLaborMin: null,
    isDefault: true,
    notes: null,
    lines,
  };
}

export interface StepRecipesProps {
  items: ItemDto[];
  catalogCommitted: boolean;
  onContinue: () => void;
}

export function StepRecipes({ items, catalogCommitted, onContinue }: StepRecipesProps) {
  const [error, setError] = useState<string | null>(null);
  const mutation = useRecordRecipe();
  const itemsByName = useMemo(
    () => new Map(items.map((item) => [item.name, item] as const)),
    [items],
  );
  const missingItemNames = useMemo(
    () => STARTER_ITEM_NAMES.filter((name) => !itemsByName.has(name)),
    [itemsByName],
  );
  const disabled = mutation.isPending;
  // Recipe creation isn't idempotent server-side (recordRecipe never rejects on a duplicate
  // name/output), so a retry after a partial failure must skip recipes this session already
  // created — otherwise it would insert a duplicate that steals the isDefault flag from the
  // original via buildClearOtherDefaultsStatement.
  const [createdNames, setCreatedNames] = useState<ReadonlySet<string>>(() => new Set());

  async function handleCreate() {
    setError(null);
    if (missingItemNames.length > 0) return;

    const pending = STARTER_RECIPES.filter((recipe) => !createdNames.has(recipe.name));
    const commands: Array<{ name: string; command: RecordRecipeCommand }> = [];
    for (const recipe of pending) {
      const command = resolveRecipeCommand(recipe, itemsByName);
      if (!command) return;
      commands.push({ name: recipe.name, command });
    }

    try {
      for (const { name, command } of commands) {
        await mutation.mutateAsync(command);
        setCreatedNames((prev) => new Set(prev).add(name));
      }
      onContinue();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : onboardingLabels.errors.generic);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-medium text-foreground text-lg">{onboardingLabels.recipesTitle}</h2>
        <p className="text-muted-foreground text-sm">{onboardingLabels.recipesBody}</p>
      </div>

      <div className="rounded-md border border-border bg-muted px-4 py-3 text-sm text-foreground">
        <p className="font-medium">{onboardingLabels.recipesPreviewTitle}</p>
        <ul className="mt-2 flex flex-col gap-1">
          {STARTER_RECIPES.map((recipe) => (
            <li key={recipe.name} className="flex flex-wrap justify-between gap-x-4">
              <span>{recipe.name}</span>
              <span className="text-muted-foreground">{recipe.outputPreview}</span>
            </li>
          ))}
        </ul>
      </div>

      {missingItemNames.length > 0 ? (
        <div className="rounded-md border border-border bg-muted px-4 py-3 text-sm" role="status">
          <p className="text-foreground">
            {catalogCommitted
              ? onboardingLabels.recipesMissingItems
              : onboardingLabels.recipesNeedsCatalog}
          </p>
          <p className="mt-1 text-muted-foreground">{missingItemNames.join(", ")}</p>
        </div>
      ) : null}

      {error ? (
        <p className="text-negative text-sm" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onContinue} disabled={disabled}>
          {onboardingLabels.skipButton}
        </Button>
        <Button
          type="button"
          onClick={handleCreate}
          disabled={disabled || missingItemNames.length > 0}
        >
          {onboardingLabels.submitRecipes}
        </Button>
      </div>
    </div>
  );
}
