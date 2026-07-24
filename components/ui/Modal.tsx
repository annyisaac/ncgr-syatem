"use client";

import { cn } from "@/lib/cn";
import { useEffect } from "react";
import type { ReactNode } from "react";
import { Button } from "./Button";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  className,
}: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="absolute inset-0 bg-ink/40"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className={cn(
          "relative z-10 flex w-full max-w-lg flex-col rounded-2xl border-t-4 border-gold bg-paper shadow-pop",
          "max-h-[92vh] overflow-hidden",
          className
        )}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-line bg-paper px-5 py-3.5">
          <h3 className="text-[0.95rem] font-bold text-ink">{title}</h3>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
        <div className="grow overflow-y-auto px-4 py-4">{children}</div>
        {footer && (
          <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-ink/10 bg-paper px-4 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
