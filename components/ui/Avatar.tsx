import { cn } from "@/lib/cn";
import type { User } from "@/lib/types";

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

/** Circular avatar: the user's uploaded picture, or their initials on gold. */
export function Avatar({
  user,
  size = 36,
  className,
}: {
  user: Pick<User, "name" | "avatar">;
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-bold",
        user.avatar ? "bg-transparent" : "bg-gold text-[#231b04]",
        className
      )}
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {user.avatar ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={user.avatar}
          alt={user.name}
          className="h-full w-full object-cover"
        />
      ) : (
        initials(user.name)
      )}
    </span>
  );
}
