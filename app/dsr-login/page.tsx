"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Deprecated. DSRs now sign in on the normal login page with their own email
 * and password, then confirm their zone-manager code on a new device (see
 * DsrGate). This route is kept only so old bookmarks/links redirect cleanly.
 */
export default function DsrLoginRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/login");
  }, [router]);
  return (
    <div className="flex min-h-screen items-center justify-center text-muted">
      Taking you to sign in…
    </div>
  );
}
