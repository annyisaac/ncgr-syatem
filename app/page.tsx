"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { homeForRole } from "@/lib/permissions";

/** Entry point: send authenticated users to their home, others to login. */
export default function RootPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    router.replace(user ? homeForRole(user.role) : "/login");
  }, [user, loading, router]);

  return (
    <div className="flex min-h-screen items-center justify-center text-ink/60">
      Loading…
    </div>
  );
}
