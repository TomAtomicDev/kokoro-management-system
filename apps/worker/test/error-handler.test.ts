// Standalone Hono app mounting only the error handler under test, so this doesn't depend on the
// real route tree — proves the DomainError -> HTTP mapping (Doc 08 §2) in isolation.
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { errorHandler } from "../src/api/error-handler.js";
import { DomainError } from "../src/core/errors.js";
import type { Env, Variables } from "../src/env.js";

interface ErrorBody {
  code: string;
  message_es: string;
  details: unknown;
}

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.onError(errorHandler);
app.get("/not-found", () => {
  throw new DomainError("NOT_FOUND", "No se encontró el ítem.", { itemId: "abc" });
});
app.get("/conflict", () => {
  throw new DomainError("CONFLICT", "La sesión ya está cerrada.");
});
app.get("/zod", (c) => {
  z.object({ qty: z.number() }).parse({ qty: "not a number" });
  return c.text("unreachable");
});
app.get("/boom", () => {
  throw new Error("unexpected");
});

describe("errorHandler", () => {
  it("maps DomainError NOT_FOUND to 404 with code/message_es/details", async () => {
    const res = await app.request("/not-found");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      code: "NOT_FOUND",
      message_es: "No se encontró el ítem.",
      details: { itemId: "abc" },
    });
  });

  it("maps DomainError CONFLICT to 409", async () => {
    const res = await app.request("/conflict");
    expect(res.status).toBe(409);
    const body = (await res.json()) as ErrorBody;
    expect(body.code).toBe("CONFLICT");
  });

  it("maps a ZodError to 400 VALIDATION", async () => {
    const res = await app.request("/zod");
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorBody;
    expect(body.code).toBe("VALIDATION");
  });

  it("maps an unexpected Error to 500 INTERNAL without leaking the message", async () => {
    const res = await app.request("/boom");
    expect(res.status).toBe(500);
    const body = (await res.json()) as ErrorBody;
    expect(body.code).toBe("INTERNAL");
    expect(body.message_es).not.toContain("unexpected");
  });
});
