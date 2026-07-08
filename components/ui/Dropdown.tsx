"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

export interface DropdownAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  disabledReason?: string;
  danger?: boolean;
  hidden?: boolean;
}

interface MenuPos {
  left: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
}

const MENU_WIDTH = 210;

/**
 * A single "Actions…" button that opens a menu of word-labelled actions.
 * The menu is rendered with fixed positioning so it is never clipped by a
 * scrolling table, and it flips upward when there isn't room below — so every
 * action is visible without scrolling the page.
 */
export function ActionsDropdown({
  actions,
  label = "Actions…",
}: {
  actions: DropdownAction[];
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<MenuPos | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  function place() {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const left = Math.max(
      8,
      Math.min(r.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8)
    );
    const spaceBelow = window.innerHeight - r.bottom;
    const spaceAbove = r.top;
    if (spaceBelow < 300 && spaceAbove > spaceBelow) {
      setPos({
        left,
        bottom: window.innerHeight - r.top + 6,
        maxHeight: Math.min(spaceAbove - 16, 380),
      });
    } else {
      setPos({
        left,
        top: r.bottom + 6,
        maxHeight: Math.min(spaceBelow - 16, 380),
      });
    }
  }

  function toggle() {
    if (!open) place();
    setOpen((v) => !v);
  }

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (
        wrapRef.current?.contains(t) ||
        menuRef.current?.contains(t)
      )
        return;
      setOpen(false);
    };
    const onScrollOrResize = () => setOpen(false);
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open]);

  const usable = actions.filter((a) => !a.hidden);

  return (
    <div className="inline-block text-left" ref={wrapRef}>
      <button
        type="button"
        onClick={toggle}
        className="rounded-md border border-line bg-paper px-2 py-1 text-[0.7rem] font-semibold text-ink transition-colors hover:border-ink"
      >
        {label}
      </button>
      {open && pos && (
        <div
          ref={menuRef}
          style={{
            position: "fixed",
            left: pos.left,
            top: pos.top,
            bottom: pos.bottom,
            width: MENU_WIDTH,
            maxHeight: pos.maxHeight,
          }}
          className="z-[80] overflow-y-auto rounded-lg border border-line bg-paper py-1 shadow-pop"
        >
          {usable.length === 0 && (
            <p className="px-3 py-2 text-xs text-muted">No actions available</p>
          )}
          {usable.map((a, i) => (
            <button
              key={i}
              type="button"
              disabled={a.disabled}
              title={a.disabled ? a.disabledReason : undefined}
              onClick={() => {
                if (a.disabled) return;
                setOpen(false);
                a.onClick();
              }}
              className={cn(
                "block w-full px-3 py-1.5 text-left text-[0.72rem] transition-colors",
                a.disabled
                  ? "cursor-not-allowed text-ink/30"
                  : a.danger
                    ? "text-red hover:bg-red-bg"
                    : "text-ink hover:bg-gold-bg"
              )}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
