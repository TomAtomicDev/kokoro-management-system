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

/** Current instant as a UTC ISO-8601 string (Doc 04 §1, `*_at` columns). */
export function nowIso(): string {
  return new Date().toISOString();
}
