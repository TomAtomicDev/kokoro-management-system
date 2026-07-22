// SC-06 · Recipes — /production/recipes (KOK-025). Header: "Nueva receta" action; table of all
// recipes; detail drawer on row click. Mirrors routes/purchases.tsx's composition.

import { useState } from "react";

import { RecipeDetailDrawer } from "@/components/recipes/RecipeDetailDrawer";
import { RecipeForm } from "@/components/recipes/RecipeForm";
import { RecipesTable } from "@/components/recipes/RecipesTable";
import { Button } from "@/components/ui/button";
import { useRecipesQuery } from "@/features/recipes/api";
import { recipesLabels } from "@/lib/i18n-recipes";

export function RecipesRoute() {
  const recipesQuery = useRecipesQuery();

  const [formOpen, setFormOpen] = useState(false);
  const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-semibold text-2xl text-foreground">{recipesLabels.title}</h1>
          <p className="text-muted-foreground text-sm">{recipesLabels.subtitle}</p>
        </div>
        <Button type="button" onClick={() => setFormOpen(true)}>
          {recipesLabels.actionRecord}
        </Button>
      </div>

      <RecipesTable
        recipes={recipesQuery.data?.recipes ?? []}
        loading={recipesQuery.isLoading}
        onRowClick={(recipe) => setSelectedRecipeId(recipe.id)}
      />

      <RecipeForm open={formOpen} onOpenChange={setFormOpen} />
      <RecipeDetailDrawer
        recipeId={selectedRecipeId}
        open={selectedRecipeId !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedRecipeId(null);
        }}
      />
    </div>
  );
}
