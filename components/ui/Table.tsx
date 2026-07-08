import { cn } from "@/lib/cn";
import type { ReactNode } from "react";

/** Responsive table wrapper — scrolls horizontally on small screens. */
export function TableWrap({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("w-full overflow-x-auto", className)}>
      <table className="data-table w-full min-w-full border-collapse text-[0.8rem]">
        {children}
      </table>
    </div>
  );
}

export function Th({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  return (
    <th
      className={cn(
        "bg-onyx px-2.5 py-2.5 text-left text-[0.64rem] font-bold uppercase tracking-wider text-[#f3e9c9] whitespace-nowrap first:rounded-tl-lg last:rounded-tr-lg",
        className
      )}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  return (
    <td className={cn("border-b border-line px-2.5 py-2.5 align-middle", className)}>
      {children}
    </td>
  );
}

/** Emphasised footer cell (ink background, gold-cream text). */
export function Tf({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  return (
    <td className={cn("bg-onyx px-2.5 py-2.5 font-bold text-[#f3e9c9]", className)}>
      {children}
    </td>
  );
}

export function EmptyRow({ colSpan, text }: { colSpan: number; text: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-8 text-center text-muted">
        {text}
      </td>
    </tr>
  );
}
