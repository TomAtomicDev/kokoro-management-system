// Own primitive for live form validation (KOK-143, agreements §A-11: no React Hook Form / TanStack
// Form — a library doesn't remove the D-5 decimal-to-integer layer and forces rewriting every
// picker/live preview). This hook owns only WHEN a field's error becomes visible — touched
// (blurred once) or submitted (a submit was attempted) — never the error itself: callers keep
// computing their own pure field-error map from current values (same shape as ItemForm's
// `validateItemFormFields`), which is what makes "live revalidation after the first error" work
// for free — once a field is visible, its computed error updates on every render as the caller's
// values change, with no extra wiring here.

import { useCallback, useRef, useState } from "react";

export interface UseFieldValidationResult {
  /** Whether `name`'s error, if any, should be shown right now. */
  isVisible: (name: string) => boolean;
  /** Attach to a field's `onBlur` — makes that field live from now on. */
  handleBlur: (name: string) => void;
  /** True once a submit has been attempted at least once — makes every field live. */
  submitted: boolean;
  /** Ref callback for a field, so `attemptSubmit` can focus it. Attach to the input/select/picker
   * DOM node (or a component that forwards its ref to one). */
  registerRef: (name: string) => (node: HTMLElement | null) => void;
  /**
   * Marks the form submitted (making every field live) and, given the current field-error map and
   * a display-order field list, focuses and scrolls to the first invalid field. Returns true when
   * there was nothing to focus, i.e. the caller may proceed with the actual submit.
   */
  attemptSubmit: (errors: Record<string, string | undefined>, order: readonly string[]) => boolean;
  /** Clears touched/submitted state — call when the form is reset onto a fresh record (e.g. a
   * dialog reopening for a different item, or a draft being cleared after a successful submit). */
  reset: () => void;
}

export function useFieldValidation(): UseFieldValidationResult {
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState(false);
  const refs = useRef<Record<string, HTMLElement | null>>({});

  const isVisible = useCallback(
    (name: string) => submitted || Boolean(touched[name]),
    [submitted, touched],
  );

  const handleBlur = useCallback((name: string) => {
    setTouched((current) => (current[name] ? current : { ...current, [name]: true }));
  }, []);

  const registerRef = useCallback(
    (name: string) => (node: HTMLElement | null) => {
      refs.current[name] = node;
    },
    [],
  );

  const attemptSubmit = useCallback(
    (errors: Record<string, string | undefined>, order: readonly string[]) => {
      setSubmitted(true);
      const firstInvalid = order.find((name) => errors[name]);
      if (!firstInvalid) return true;
      const node = refs.current[firstInvalid];
      if (node) {
        node.focus();
        node.scrollIntoView({ block: "center", behavior: "smooth" });
      }
      return false;
    },
    [],
  );

  const reset = useCallback(() => {
    setTouched({});
    setSubmitted(false);
    refs.current = {};
  }, []);

  return { isVisible, handleBlur, submitted, registerRef, attemptSubmit, reset };
}
