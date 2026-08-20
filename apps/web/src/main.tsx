import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RecipeTimerProvider } from "@/components/layout/recipe-timer-context";
import { ToastProvider } from "@/components/ui/toast";
import { initializeTheme } from "@/features/theme/use-theme";
import { queryClient } from "@/lib/query-client";
import { registerServiceWorker } from "@/lib/service-worker";
import { router } from "@/router";

import "@/styles/globals.css";

initializeTheme();

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RecipeTimerProvider>
          <RouterProvider router={router} />
        </RecipeTimerProvider>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void registerServiceWorker();
  });
}
