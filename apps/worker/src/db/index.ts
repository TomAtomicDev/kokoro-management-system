import { drizzle } from "drizzle-orm/d1";

import * as schema from "./schema.js";

export type Db = ReturnType<typeof createDb>;

/** Typed Drizzle client over the Worker's D1 binding. core/ services take this, never a raw D1Database. */
export function createDb(d1: D1Database): ReturnType<typeof drizzle<typeof schema>> {
  return drizzle(d1, { schema });
}

export { schema };
