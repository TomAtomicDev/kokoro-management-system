// Business-date utilities — INV-3 (Doc 02 §5).
//
// Every business event stores its instant as UTC ISO-8601 AND a `business_date`
// (local calendar date in the shop's timezone) computed at write time; all
// reports group by `business_date`. This module derives that local date.
//
// We convert via the platform `Intl.DateTimeFormat` `timeZone` option rather
// than a hardcoded UTC-4 offset: it is the actually-correct, testable approach
// and needs no dependency (rule D-10). Bolivia has no DST, but going through
// Intl keeps the util honest if the configured timezone ever changes.

import { z } from "zod";

/** Default shop timezone (app_settings seed `timezone`, Doc 04 §7). */
export const DEFAULT_TIMEZONE = "America/La_Paz";

/**
 * Derive the local `business_date` (`YYYY-MM-DD`) for an instant.
 *
 * @param instant a Date or an ISO-8601 string (parsed as an absolute instant).
 * @param timezone IANA timezone name; defaults to America/La_Paz. Callers will
 *   later pass the value configured in app_settings.
 *
 * Example: `2026-07-14T02:00:00Z` is 22:00 on 2026-07-13 in La Paz (UTC-4), so
 * the business_date is `2026-07-13`.
 */
export function toBusinessDate(
  instant: Date | string,
  timezone: string = DEFAULT_TIMEZONE,
): string {
  const date = typeof instant === "string" ? new Date(instant) : instant;
  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`toBusinessDate: invalid instant: ${String(instant)}`);
  }

  // en-CA yields ISO-ordered parts; we assemble explicitly from parts so the
  // output is independent of any locale's formatting quirks.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  let year = "";
  let month = "";
  let day = "";
  for (const part of parts) {
    if (part.type === "year") year = part.value;
    else if (part.type === "month") month = part.value;
    else if (part.type === "day") day = part.value;
  }
  return `${year}-${month}-${day}`;
}

/** Format an instant for a `datetime-local` input in the shop's timezone. */
export function toDatetimeLocal(
  instant: Date | string,
  timezone: string = DEFAULT_TIMEZONE,
): string {
  const date = typeof instant === "string" ? new Date(instant) : instant;
  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`toDatetimeLocal: invalid instant: ${String(instant)}`);
  }

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  let year = "";
  let month = "";
  let day = "";
  let hour = "";
  let minute = "";
  for (const part of parts) {
    if (part.type === "year") year = part.value;
    else if (part.type === "month") month = part.value;
    else if (part.type === "day") day = part.value;
    else if (part.type === "hour") hour = part.value;
    else if (part.type === "minute") minute = part.value;
  }
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

/**
 * Convert a `datetime-local` wall-clock value in the shop's timezone to a UTC instant.
 * The offset is resolved through Intl rather than being hard-coded, so this remains correct if
 * the configured timezone ever changes.
 */
export function fromDatetimeLocal(
  value: string,
  timezone: string = DEFAULT_TIMEZONE,
): string | undefined {
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(trimmed)) return undefined;

  const wallClockAsUtc = Date.parse(`${trimmed}:00.000Z`);
  if (Number.isNaN(wallClockAsUtc)) return undefined;

  const wallClockParts = toDatetimeLocal(new Date(wallClockAsUtc), timezone);
  const formattedAsUtc = Date.parse(`${wallClockParts}:00.000Z`);
  if (Number.isNaN(formattedAsUtc)) return undefined;

  const instant = new Date(wallClockAsUtc + wallClockAsUtc - formattedAsUtc);
  return toDatetimeLocal(instant, timezone) === trimmed ? instant.toISOString() : undefined;
}

/** Current instant as a UTC ISO-8601 string (Doc 04 §1, `*_at` columns). */
export function nowIso(): string {
  return new Date().toISOString();
}

/** `YYYY-MM-DD` calendar date in the shop's timezone (Doc 04 §1, INV-3). Future values are valid
 * for promises such as `custom_orders.delivery_date`; transaction dates use `businessDateSchema`
 * below when they must not be future-dated. THE single source; every command schema in
 * packages/shared imports this rather than declaring its own copy (D-4). */
export const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha debe tener el formato AAAA-MM-DD.");

/** `YYYY-MM-DD`, America/La_Paz local transaction date (Doc 04 §1, INV-3). Rejects a future
 * business date (Doc 04 §5, agreements §A-6): transactions post immediately and affect today's
 * balance, so a future date would communicate something false. Backdating remains fully allowed
 * — only a date strictly after today (America/La_Paz) is rejected. */
export const businessDateSchema = calendarDateSchema.refine(
  (value) => (Number.isNaN(new Date(value).getTime()) ? true : value <= toBusinessDate(new Date())),
  {
    message: "La fecha no puede ser futura.",
  },
);

/** UTC ISO-8601 instant (Doc 04 §1). Same future-date rule as `businessDateSchema`, checked
 * independently on this field's own America/La_Paz business date (callers supply both fields
 * separately; either could be wrong). THE single source — see `businessDateSchema`'s note. */
export const occurredAtSchema = z
  .string()
  .datetime({ offset: true, message: "occurredAt debe ser una fecha ISO-8601." })
  .refine(
    (value) =>
      Number.isNaN(new Date(value).getTime())
        ? true
        : toBusinessDate(value) <= toBusinessDate(new Date()),
    {
      message: "occurredAt no puede ser una fecha futura.",
    },
  );
