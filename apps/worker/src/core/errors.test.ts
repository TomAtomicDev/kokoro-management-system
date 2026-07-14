import { describe, expect, it } from "vitest";

import { DomainError, conflict, notFound, validationError } from "./errors.js";

describe("DomainError", () => {
  it("maps each code to the HTTP status from Doc 08 §2", () => {
    expect(new DomainError("VALIDATION", "x").httpStatus).toBe(400);
    expect(new DomainError("NOT_FOUND", "x").httpStatus).toBe(404);
    expect(new DomainError("CONFLICT", "x").httpStatus).toBe(409);
    expect(new DomainError("INTERNAL", "x").httpStatus).toBe(500);
  });

  it("carries message_es and optional details", () => {
    const err = new DomainError("NOT_FOUND", "No se encontró el ítem.", { itemId: "abc" });
    expect(err.message_es).toBe("No se encontró el ítem.");
    expect(err.details).toEqual({ itemId: "abc" });
    expect(err.message).toBe("No se encontró el ítem."); // Error.message mirrors message_es
  });

  it("is an instanceof Error", () => {
    expect(new DomainError("INTERNAL", "x")).toBeInstanceOf(Error);
  });

  it("factory helpers build the right code", () => {
    expect(notFound("x").code).toBe("NOT_FOUND");
    expect(validationError("x").code).toBe("VALIDATION");
    expect(conflict("x").code).toBe("CONFLICT");
  });
});
