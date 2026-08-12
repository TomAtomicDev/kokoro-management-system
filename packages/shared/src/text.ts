import { z } from "zod";

// Keep ordinary formatting whitespace useful for multi-line notes while removing control and
// invisible formatting characters. CRLF input remains intact as a line break.
const CONTROL_CHARACTER_PATTERN = /(?![\t\n\r])[\p{Cc}\p{Cf}]/gu;

function stripControlCharacters(value: string): string {
  return value.replace(CONTROL_CHARACTER_PATTERN, "");
}

/** A bounded text schema that strips Unicode control/invisible formatting characters. */
export function safeText(maxLength: number): z.ZodType<string> {
  return z.string().transform(stripControlCharacters).pipe(z.string().max(maxLength));
}
