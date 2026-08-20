export function parseRecipeTimerDuration(value: string): number | null {
  const match = /^(\d{1,6}):([0-5]\d)$/u.exec(value.trim());
  if (!match) return null;
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  if (!Number.isSafeInteger(minutes) || minutes < 0) return null;
  const totalSeconds = minutes * 60 + seconds;
  return Number.isSafeInteger(totalSeconds) && totalSeconds > 0 ? totalSeconds : null;
}

export function formatRecipeTimerDuration(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function formatSuggestedRecipeTimer(estLaborMin: number | null): string {
  return estLaborMin === null ? "" : formatRecipeTimerDuration(estLaborMin * 60);
}
