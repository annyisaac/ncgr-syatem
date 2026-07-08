"use client";

import type { ReactNode } from "react";
import { AuthProvider } from "./AuthProvider";
import { DataProvider } from "./DataProvider";
import { ThemeProvider } from "./ThemeProvider";
import { ToastProvider } from "./ui/Toast";

/** Client-side context providers wrapping the whole app. */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <AuthProvider>
        <DataProvider>
          <ToastProvider>{children}</ToastProvider>
        </DataProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
