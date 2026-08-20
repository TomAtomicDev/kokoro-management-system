import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useToast } from "@/components/ui/toast";
import { recipesLabels } from "@/lib/i18n-recipes";

export const RECIPE_TIMER_STORAGE_KEY = "kokoro.recipe-timer.v1";
// scale-factor-ok: wall-clock timer conversion, not money or quantity arithmetic.
const MILLISECONDS_PER_SECOND = 1_000;

export interface RecipeTimerState {
  recipeId: string;
  recipeName: string;
  durationSeconds: number;
  startedAt: number;
  status: "running" | "completed";
}

export interface StartRecipeTimerInput {
  recipeId: string;
  recipeName: string;
  durationSeconds: number;
}

export type StartRecipeTimerResult = { ok: true } | { ok: false; reason: "activeTimer" };

interface RecipeTimerContextValue {
  timer: RecipeTimerState | null;
  remainingSeconds: number;
  startTimer: (input: StartRecipeTimerInput) => StartRecipeTimerResult;
  stopTimer: () => void;
  dismissTimer: () => void;
}

const RecipeTimerContext = createContext<RecipeTimerContextValue | null>(null);

function getStorage(): Storage | null {
  try {
    if (typeof globalThis.localStorage === "undefined") return null;
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function isRecipeTimerState(value: unknown): value is RecipeTimerState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.recipeId === "string" &&
    typeof candidate.recipeName === "string" &&
    typeof candidate.durationSeconds === "number" &&
    Number.isSafeInteger(candidate.durationSeconds) &&
    candidate.durationSeconds > 0 &&
    typeof candidate.startedAt === "number" &&
    Number.isFinite(candidate.startedAt) &&
    (candidate.status === "running" || candidate.status === "completed")
  );
}

function readStoredTimer(): RecipeTimerState | null {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(RECIPE_TIMER_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isRecipeTimerState(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function getRemainingSeconds(timer: RecipeTimerState, now: number): number {
  if (timer.status === "completed") return 0;
  return Math.max(
    0,
    Math.ceil(
      (timer.startedAt + timer.durationSeconds * MILLISECONDS_PER_SECOND - now) /
        MILLISECONDS_PER_SECOND,
    ),
  );
}

function playRecipeTimerAlarm(): void {
  try {
    if (typeof window !== "undefined" && typeof window.AudioContext === "function") {
      const audioContext = new window.AudioContext();
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.18, audioContext.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.5);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start();
      oscillator.stop(audioContext.currentTime + 0.5);
      oscillator.addEventListener("ended", () => {
        void audioContext.close();
      });
    }
  } catch {
    // Audio is best effort: the visible chip and toast are the reliable alarm paths.
  }

  try {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate([180, 80, 180]);
    }
  } catch {
    // Vibration is optional and unavailable in most desktop browsers.
  }
}

export function RecipeTimerProvider({ children }: { children: ReactNode }) {
  const { show } = useToast();
  const [timer, setTimer] = useState<RecipeTimerState | null>(readStoredTimer);
  const [now, setNow] = useState(() => Date.now());
  const alarmedTimerRef = useRef<number | null>(null);

  const remainingSeconds = timer ? getRemainingSeconds(timer, now) : 0;

  useEffect(() => {
    const storage = getStorage();
    if (!storage) return;
    try {
      if (timer) {
        storage.setItem(RECIPE_TIMER_STORAGE_KEY, JSON.stringify(timer));
      } else {
        storage.removeItem(RECIPE_TIMER_STORAGE_KEY);
      }
    } catch {
      // A blocked or full localStorage must not stop an in-memory timer.
    }
  }, [timer]);

  useEffect(() => {
    if (timer?.status !== "running") return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [timer]);

  useEffect(() => {
    if (timer?.status !== "running" || remainingSeconds > 0) return;
    if (alarmedTimerRef.current === timer.startedAt) return;
    alarmedTimerRef.current = timer.startedAt;
    setTimer((current) => {
      if (current?.status !== "running") return current;
      return { ...current, status: "completed" };
    });
    playRecipeTimerAlarm();
    show({ message: recipesLabels.timer.alarmMessage });
  }, [remainingSeconds, show, timer]);

  const startTimer = useCallback(
    (input: StartRecipeTimerInput): StartRecipeTimerResult => {
      if (timer && timer.status === "running" && getRemainingSeconds(timer, Date.now()) > 0) {
        return { ok: false, reason: "activeTimer" };
      }
      const startedAt = Date.now();
      setNow(startedAt);
      setTimer({ ...input, startedAt, status: "running" });
      return { ok: true };
    },
    [timer],
  );

  const stopTimer = useCallback(() => {
    setTimer(null);
  }, []);

  const dismissTimer = useCallback(() => {
    setTimer(null);
  }, []);

  const value = useMemo(
    () => ({ timer, remainingSeconds, startTimer, stopTimer, dismissTimer }),
    [dismissTimer, remainingSeconds, startTimer, stopTimer, timer],
  );

  return <RecipeTimerContext.Provider value={value}>{children}</RecipeTimerContext.Provider>;
}

export function useRecipeTimer(): RecipeTimerContextValue {
  const context = useContext(RecipeTimerContext);
  if (!context) throw new Error("useRecipeTimer must be used within RecipeTimerProvider");
  return context;
}

export function getRecipeTimerRemainingSeconds(timer: RecipeTimerState, now: number): number {
  return getRemainingSeconds(timer, now);
}
