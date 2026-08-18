"use client";

/**
 * Registers the service worker and surfaces two small, dismissible prompts:
 *  - "Install app" — Android/Chrome fire `beforeinstallprompt`; iOS gets
 *    Add-to-Home-Screen instructions (no programmatic prompt on Safari).
 *  - "Update available" — when a new service worker takes over, offer a refresh.
 * Renders nothing when already installed (standalone) or dismissed.
 */

import { useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "ncgr:pwa:install-dismissed";

export function PWA() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [showInstall, setShowInstall] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [updateReady, setUpdateReady] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      // iOS Safari standalone flag
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;

    // Register the service worker.
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/", updateViaCache: "none" })
        .then((reg) => {
          reg.addEventListener("updatefound", () => {
            const nw = reg.installing;
            if (!nw) return;
            nw.addEventListener("statechange", () => {
              if (nw.state === "installed" && navigator.serviceWorker.controller) {
                setUpdateReady(true);
              }
            });
          });
        })
        .catch(() => {});
    }

    if (standalone) return; // already installed — no install prompt

    const dismissed = (() => { try { return localStorage.getItem(DISMISS_KEY) === "1"; } catch { return false; } })();

    // iOS has no beforeinstallprompt — show manual instructions instead.
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !(window as unknown as { MSStream?: unknown }).MSStream;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (ios && !dismissed) { setIsIOS(true); setShowInstall(true); }

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      if (!dismissed) setShowInstall(true);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    const onInstalled = () => { setShowInstall(false); setDeferred(null); };
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  function dismiss() {
    setShowInstall(false);
    try { localStorage.setItem(DISMISS_KEY, "1"); } catch { /* ignore */ }
  }

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice.catch(() => undefined);
    setDeferred(null);
    setShowInstall(false);
  }

  return (
    <>
      {updateReady && (
        <div className="fixed inset-x-0 top-0 z-[100] flex items-center justify-center gap-3 bg-onyx px-4 py-2 text-sm text-[#f3e9c9] shadow-lg">
          <span>A new version is available.</span>
          <button
            onClick={() => window.location.reload()}
            className="rounded-md bg-gold px-3 py-1 text-xs font-semibold text-[#231b04]"
          >
            Refresh
          </button>
        </div>
      )}

      {showInstall && (
        <div className="fixed inset-x-3 bottom-3 z-[100] mx-auto max-w-md rounded-2xl border border-line bg-paper p-4 shadow-card">
          <div className="flex items-start gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icon-192.png" alt="" width={40} height={40} className="h-10 w-10 shrink-0 rounded-xl" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-ink">Install the NCGR app</p>
              {isIOS ? (
                <p className="mt-0.5 text-xs text-muted">
                  In <strong>Safari</strong>, tap Share <span aria-hidden>⎋</span>, then <strong>Add to Home Screen</strong> to install.
                </p>
              ) : (
                <p className="mt-0.5 text-xs text-muted">Add it to your home screen for quick, full-screen access.</p>
              )}
              <div className="mt-2.5 flex items-center gap-2">
                {!isIOS && deferred && (
                  <button onClick={install} className="rounded-lg bg-gold px-3 py-1.5 text-xs font-semibold text-[#231b04]">
                    Install
                  </button>
                )}
                <button onClick={dismiss} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-muted hover:text-ink">
                  Not now
                </button>
              </div>
            </div>
            <button onClick={dismiss} aria-label="Dismiss" className="shrink-0 text-muted hover:text-ink">✕</button>
          </div>
        </div>
      )}
    </>
  );
}
