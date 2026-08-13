"use client";

import { useEffect } from "react";

/**
 * After a new deployment, tabs opened on the previous build reference JS chunk
 * files whose hashes have changed. Navigating then fails with a chunk-load error
 * ("This page couldn't load"). This guard listens for that specific error and
 * reloads once to pick up the new build — guarded so it can never loop.
 */
export function ChunkReloadGuard() {
  useEffect(() => {
    const isChunkError = (msg: string) =>
      /Loading chunk [\w-]+ failed/i.test(msg) ||
      /ChunkLoadError/i.test(msg) ||
      /Loading CSS chunk/i.test(msg) ||
      /Failed to fetch dynamically imported module/i.test(msg) ||
      /Importing a module script failed/i.test(msg);

    const reloadOnce = () => {
      try {
        const KEY = "ncgr.chunkReload";
        const last = Number(sessionStorage.getItem(KEY) || 0);
        if (Date.now() - last < 15000) return; // already reloaded very recently — don't loop
        sessionStorage.setItem(KEY, String(Date.now()));
      } catch {
        /* private mode / no storage — still reload once */
      }
      window.location.reload();
    };

    const onError = (e: ErrorEvent) => {
      if (e?.message && isChunkError(e.message)) reloadOnce();
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      const m = e?.reason?.message ?? String(e?.reason ?? "");
      if (isChunkError(m)) reloadOnce();
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
