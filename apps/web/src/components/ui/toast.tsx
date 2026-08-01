// Hand-rolled toast/undo system (KOK-024 Phase G). No toast primitive existed anywhere in this
// app before this file, and D-10 forbids adding one (no sonner, no radix-toast) — a context
// holding a short-lived array of toasts is all this app ever needs (a handful at a time, never
// many at once), mirroring Dialog's own "small enough to own directly" precedent
// (components/ui/dialog.tsx's header).
//
// Doc 06 UX principle 6: "Undo over confirm-dialogs — destructive actions use soft delete + 10s
// 'Deshacer' toast (INV-10) instead of '¿Estás segura?' walls." `UNDO_TOAST_DURATION_MS` and
// `showUndo` exist so a call site gets that 10s window without repeating the constant. Doc 06 §3
// also bans bounce/spring easing everywhere in this app — the entrance/exit here is a plain
// opacity+translate fade using the existing --duration-normal token, nothing playful.
//
// Copy is feature-owned (i18n-purchases.ts / i18n-inventory.ts, D-9): this file hardcodes no
// Spanish beyond the close button's aria-label and the toast region's own accessible name, which
// are chrome, not feature copy.

import { X } from "lucide-react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

export interface ShowToastOptions {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  /** Auto-dismiss delay in ms. Defaults to 5000; `showUndo` forces 10 000 per Doc 06 principle 6. */
  durationMs?: number;
}

interface ToastItem extends ShowToastOptions {
  id: string;
  closing: boolean;
}

export interface ToastContextValue {
  /** Show a plain toast. Auto-dismisses after `durationMs` (default 5000ms). */
  show: (options: ShowToastOptions) => void;
  /** Show the destructive-action undo toast: same as `show`, but always uses the 10s window Doc 06
   * principle 6 specifies, so a call site never has to remember the magic number. */
  showUndo: (options: Omit<ShowToastOptions, "durationMs">) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const DEFAULT_DURATION_MS = 5000;
/** Doc 06 UX principle 6's "10 s 'Deshacer' toast" window. */
export const UNDO_TOAST_DURATION_MS = 10_000;
/** How long the exit fade takes before a toast is actually removed from the DOM — kept short and
 * linear (Doc 06 §3: no bounce/spring), matching --duration-normal (220ms) with a little slack. */
const CLOSE_ANIMATION_MS = 200;

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    // Mark it closing first so ToastCard can play its exit fade, then actually drop it from state
    // once that fade has had time to finish.
    setToasts((current) => current.map((t) => (t.id === id ? { ...t, closing: true } : t)));
    window.setTimeout(() => {
      setToasts((current) => current.filter((t) => t.id !== id));
    }, CLOSE_ANIMATION_MS);
  }, []);

  const show = useCallback(
    (options: ShowToastOptions) => {
      const id = crypto.randomUUID();
      const durationMs = options.durationMs ?? DEFAULT_DURATION_MS;
      setToasts((current) => [...current, { ...options, id, closing: false }]);
      if (durationMs > 0) {
        window.setTimeout(() => dismiss(id), durationMs);
      }
    },
    [dismiss],
  );

  const showUndo = useCallback(
    (options: Omit<ShowToastOptions, "durationMs">) => {
      show({ ...options, durationMs: UNDO_TOAST_DURATION_MS });
    },
    [show],
  );

  const value = useMemo(() => ({ show, showUndo }), [show, showUndo]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}) {
  if (toasts.length === 0) return null;
  return createPortal(
    <section
      aria-label="Notificaciones"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4"
    >
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} onRequestDismiss={onDismiss} />
      ))}
    </section>,
    document.body,
  );
}

function ToastCard({
  toast,
  onRequestDismiss,
}: {
  toast: ToastItem;
  onRequestDismiss: (id: string) => void;
}) {
  // Entrance fade: start hidden, flip to visible one frame after mount so the transition actually
  // runs (mounting already-visible would skip straight to the end state).
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  const visible = entered && !toast.closing;

  return (
    <div
      role="status"
      className={cn(
        "pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-md border border-border",
        "bg-card px-4 py-3 text-card-foreground text-sm shadow-lg transition-all duration-normal",
        visible ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0",
      )}
    >
      <span className="flex-1">{toast.message}</span>
      {toast.actionLabel && toast.onAction ? (
        <button
          type="button"
          className="shrink-0 font-medium text-primary hover:underline"
          onClick={() => {
            toast.onAction?.();
            onRequestDismiss(toast.id);
          }}
        >
          {toast.actionLabel}
        </button>
      ) : null}
      <button
        type="button"
        aria-label="Cerrar"
        className="shrink-0 text-muted-foreground hover:text-foreground"
        onClick={() => onRequestDismiss(toast.id)}
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
