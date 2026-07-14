// Login rate limiting (KOK-007: "rate limit 5 tries/15 min"). Doc 04 has no dedicated
// rate-limit table — deliberately reused `audit_log` instead of adding one: a failed login is
// itself an auditable security event (actor SYSTEM, action 'login_failed', entity 'auth'/'owner'),
// and counting recent rows in a 15-minute window is all rate limiting needs. No KB schema
// amendment required since this is additive use of an existing table, not a new one.

import { and, eq, gte } from "drizzle-orm";

import { buildAuditLogInsert } from "../core/audit.js";
import type { Db } from "../db/index.js";
import { auditLog } from "../db/schema.js";

export const RATE_LIMIT_WINDOW_MINUTES = 15;
export const RATE_LIMIT_MAX_ATTEMPTS = 5;

const LOGIN_ENTITY_TYPE = "auth";
const LOGIN_ENTITY_ID = "owner";
const LOGIN_FAILED_ACTION = "login_failed";

/** True if 5+ failed login attempts were recorded in the last 15 minutes. */
export async function isLoginRateLimited(db: Db, now: Date = new Date()): Promise<boolean> {
  const windowStart = new Date(now.getTime() - RATE_LIMIT_WINDOW_MINUTES * 60 * 1000).toISOString();

  const recentFailures = await db
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.action, LOGIN_FAILED_ACTION),
        eq(auditLog.entityType, LOGIN_ENTITY_TYPE),
        gte(auditLog.at, windowStart),
      ),
    );

  return recentFailures.length >= RATE_LIMIT_MAX_ATTEMPTS;
}

/** Records one failed login attempt (executes immediately — a single insert is already atomic). */
export async function recordFailedLoginAttempt(db: Db): Promise<void> {
  await buildAuditLogInsert(db, {
    actor: "SYSTEM",
    action: LOGIN_FAILED_ACTION,
    entityType: LOGIN_ENTITY_TYPE,
    entityId: LOGIN_ENTITY_ID,
  });
}
