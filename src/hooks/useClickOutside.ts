"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * Returns a ref to attach to a popover's container; while `active` is true, any pointer-down
 * outside that container fires `onOutside` (e.g. to close the popover). The callback is read from
 * a ref internally so callers don't need to memoize it themselves.
 */
export function useClickOutside<T extends HTMLElement>(active: boolean, onOutside: () => void): RefObject<T | null> {
  const ref = useRef<T>(null);
  const onOutsideRef = useRef(onOutside);

  useEffect(() => {
    onOutsideRef.current = onOutside;
  });

  useEffect(() => {
    if (!active) return;

    function handlePointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutsideRef.current();
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [active]);

  return ref;
}
