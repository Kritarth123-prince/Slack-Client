"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

/**
 * A small modal: dimmed backdrop, focus moved inside on open, Escape/backdrop to dismiss (unless
 * `busy`, so a running operation can't be abandoned by a stray click). Replaces window.confirm,
 * which can't explain consequences or show progress.
 */
export function Dialog({
  open,
  title,
  onClose,
  busy = false,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  busy?: boolean;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    requestAnimationFrame(() => {
      const target = panelRef.current?.querySelector<HTMLElement>("[data-autofocus], button:not([disabled])");
      target?.focus();
    });
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onCloseRef.current();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previouslyFocused?.focus?.();
    };
  }, [open, busy]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="popover-surface w-full max-w-md rounded-2xl"
      >
        <div className="flex items-start gap-3 px-5 pt-5">
          <h2 className="flex-1 text-base font-semibold text-fg">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="-mr-1.5 -mt-1 flex h-8 w-8 items-center justify-center rounded-md text-subtle hover:bg-surface-2 hover:text-fg disabled:opacity-40"
          >
            <X size={16} />
          </button>
        </div>
        <div className="px-5 pt-2 pb-5 text-sm text-muted">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

const BUTTON = "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg px-3.5 text-sm font-medium disabled:opacity-50";

export const buttonStyles = {
  primary: `${BUTTON} btn-primary`,
  secondary: `${BUTTON} border border-line bg-surface text-fg hover:bg-surface-2`,
  danger: `${BUTTON} bg-danger text-white hover:opacity-90`,
  ghost: `${BUTTON} text-muted hover:bg-surface-2 hover:text-fg`,
};

/** A yes/no confirmation built on Dialog. */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog
      open={open}
      title={title}
      onClose={onCancel}
      busy={busy}
      footer={
        <>
          <button type="button" onClick={onCancel} disabled={busy} className={buttonStyles.secondary}>
            Cancel
          </button>
          <button
            type="button"
            data-autofocus
            onClick={onConfirm}
            disabled={busy}
            className={danger ? buttonStyles.danger : buttonStyles.primary}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      {children}
    </Dialog>
  );
}
