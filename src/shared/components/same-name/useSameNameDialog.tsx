// src/shared/components/same-name/useSameNameDialog.tsx
import React, { useCallback, useEffect, useRef, useState } from "react";
import SameNameDialog, { type SameNameChoice, type SameNameRequest } from "./SameNameDialog";

/**
 * The "already exists" dialog as a question a write path can await (T163):
 * `ask` opens it and resolves with what the player chose, and `dialog` is
 * the element to render while it is open. One question at a time; a second
 * `ask` while one is open answers the first with a cancel.
 */
export function useSameNameDialog(): {
  ask: (request: SameNameRequest) => Promise<SameNameChoice>;
  dialog: React.ReactNode;
} {
  const [request, setRequest] = useState<SameNameRequest | null>(null);
  const answer = useRef<((choice: SameNameChoice) => void) | null>(null);

  const ask = useCallback(
    (next: SameNameRequest) =>
      new Promise<SameNameChoice>((resolve) => {
        answer.current?.({ action: "cancel" });
        answer.current = resolve;
        setRequest(next);
      }),
    []
  );

  const choose = useCallback((choice: SameNameChoice) => {
    const resolve = answer.current;
    answer.current = null;
    setRequest(null);
    resolve?.(choice);
  }, []);

  // A surface closed while asking leaves no promise waiting forever.
  useEffect(() => () => answer.current?.({ action: "cancel" }), []);

  return {
    ask,
    dialog: request ? <SameNameDialog {...request} onChoose={choose} /> : null,
  };
}

export default useSameNameDialog;
