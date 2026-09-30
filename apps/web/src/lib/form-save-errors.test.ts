import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api";
import {
  dismissFormSaveError,
  FORM_SAVE_ERROR_META,
  getFormSaveErrorMessage,
  showFormSaveError,
  subscribeToFormSaveErrors,
} from "@/lib/form-save-errors";

describe("form save error alert", () => {
  it("uses the server message only for opted-in API save failures", () => {
    const message = "No se pudo guardar el registro.";

    expect(
      getFormSaveErrorMessage(FORM_SAVE_ERROR_META, new ApiError("CONFLICT", message, {})),
    ).toBe(message);
    expect(getFormSaveErrorMessage(undefined, new ApiError("CONFLICT", message, {}))).toBeNull();
    expect(getFormSaveErrorMessage(FORM_SAVE_ERROR_META, new Error(message))).toBeNull();
  });

  it("leaves connectivity, authentication, and replay-confirmation handling unchanged", () => {
    expect(
      getFormSaveErrorMessage(
        FORM_SAVE_ERROR_META,
        new ApiError("NETWORK_ERROR", "No hay conexión a internet", {}),
      ),
    ).toBeNull();
    expect(
      getFormSaveErrorMessage(
        FORM_SAVE_ERROR_META,
        new ApiError("UNAUTHORIZED", "La sesión venció.", {}),
      ),
    ).toBeNull();
    expect(
      getFormSaveErrorMessage(
        FORM_SAVE_ERROR_META,
        new ApiError("CONFLICT", "Confirma el impacto.", {
          reason: "REPLAY_CONFIRMATION_REQUIRED",
        }),
      ),
    ).toBeNull();
    expect(
      getFormSaveErrorMessage(
        { ...FORM_SAVE_ERROR_META, suppressConflictAlert: true },
        new ApiError("CONFLICT", "Ya existe.", {}),
      ),
    ).toBeNull();
  });

  it("keeps the latest message until explicitly dismissed", () => {
    const messages: (string | null)[] = [];
    const unsubscribe = subscribeToFormSaveErrors((message) => messages.push(message));

    showFormSaveError("No se pudo guardar.");
    showFormSaveError("El registro cambió. Intenta de nuevo.");
    expect(messages).toEqual([
      null,
      "No se pudo guardar.",
      "El registro cambió. Intenta de nuevo.",
    ]);

    dismissFormSaveError();
    expect(messages.at(-1)).toBeNull();
    unsubscribe();
    showFormSaveError("Este aviso no debe llegar al suscriptor cerrado.");
    expect(messages).toHaveLength(4);
    dismissFormSaveError();
  });
});
