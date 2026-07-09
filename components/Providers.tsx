"use client";

import type { ReactNode } from "react";
import { AuthProvider } from "./AuthProvider";
import { DataProvider } from "./DataProvider";
import { HatcheryProvider } from "./HatcheryProvider";
import { ThemeProvider } from "./ThemeProvider";
import { ToastProvider } from "./ui/Toast";

/** Client-side context providers wrapping the whole app. */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <AuthProvider>
        <DataProvider>
          <HatcheryProvider>
            <ToastProvider>{children}</ToastProvider>
          </HatcheryProvider>
        </DataProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
