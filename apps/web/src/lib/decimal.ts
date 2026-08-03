// Decimal-string <-> integer conversion for money/qty form inputs (D-5: money and quantity are
// always integers — centavos / milli-units — never a float). A user types "12,50" or "12.50";
// this turns that into the exact integer 1250 via string digit-shifting, never parseFloat/`* 100`
// (both are float operations that can silently misround, e.g. 1.005 * 100 !== 100.5 in IEEE754).

/**
 * Parses a decimal string (Bolivian input accepts either "," or "." as the separator) into an
 * integer at `scale` decimal places. Returns null for blank input or anything that isn't a
 * non-negative decimal with at most `scale` meaningful fractional digits (trailing zeroes are
 * ignored).
 */
export function parseDecimalToInt(input: string, scale: number): number | null {
  const trimmed = input.trim().replace(",", ".");
  if (trimmed === "") return null;
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;

  const [intPart = "0", originalFracPart = ""] = trimmed.split(".");
  const fracPart =
    originalFracPart.length > scale ? originalFracPart.replace(/0+$/, "") : originalFracPart;
  if (fracPart.length > scale) return null;

  const digits = `${intPart}${fracPart.padEnd(scale, "0")}`.replace(/^0+(?=\d)/, "");
  const value = Number(digits);
  return Number.isSafeInteger(value) ? value : null;
}

/** Returns whether a valid decimal has non-zero digits beyond the requested scale. */
export function exceedsScale(input: string, scale: number): boolean {
  const trimmed = input.trim().replace(",", ".");
  if (trimmed === "" || !/^\d+(\.\d+)?$/.test(trimmed)) return false;

  const [, originalFracPart = ""] = trimmed.split(".");
  const fracPart =
    originalFracPart.length > scale ? originalFracPart.replace(/0+$/, "") : originalFracPart;
  return fracPart.length > scale;
}

/** Inverse of parseDecimalToInt — formats a stored integer back into an editable decimal string. */
export function formatIntAsDecimalInput(value: number, scale: number): string {
  const negative = value < 0;
  const abs = Math.abs(value)
    .toString()
    .padStart(scale + 1, "0");
  const intPart = abs.slice(0, abs.length - scale);
  const fracPart = abs.slice(abs.length - scale).replace(/0+$/, "");
  const body = fracPart ? `${intPart}.${fracPart}` : intPart;
  return negative ? `-${body}` : body;
}
