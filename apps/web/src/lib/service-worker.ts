import { showGlobalToast } from "@/components/ui/toast";
import { commonLabels } from "@/lib/i18n-common";

const SERVICE_WORKER_URL = "/sw.js";
const SKIP_WAITING_MESSAGE = { type: "SKIP_WAITING" } as const;

export async function registerServiceWorker(): Promise<void> {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;

  try {
    const hadControllerAtRegistration = Boolean(navigator.serviceWorker.controller);
    const registration = await navigator.serviceWorker.register(SERVICE_WORKER_URL);
    let updatePromptShown = false;

    const showUpdatePrompt = () => {
      if (updatePromptShown || !hadControllerAtRegistration || !registration.waiting) return;
      updatePromptShown = true;

      showGlobalToast({
        message: commonLabels.pwaUpdateAvailable,
        actionLabel: commonLabels.pwaUpdateAction,
        durationMs: 0,
        onAction: () => activateWaitingWorker(registration),
      });
    };

    registration.addEventListener("updatefound", () => {
      const installingWorker = registration.installing;
      if (!installingWorker) return;

      installingWorker.addEventListener("statechange", () => {
        if (installingWorker.state === "installed") showUpdatePrompt();
      });
    });

    showUpdatePrompt();
    await registration.update();
    showUpdatePrompt();
  } catch {
    // An unavailable service worker must never prevent the app from loading.
  }
}

function activateWaitingWorker(registration: ServiceWorkerRegistration): void {
  const waitingWorker = registration.waiting;
  if (!waitingWorker) {
    window.location.reload();
    return;
  }

  navigator.serviceWorker.addEventListener("controllerchange", () => window.location.reload(), {
    once: true,
  });
  waitingWorker.postMessage(SKIP_WAITING_MESSAGE);
}
