"use client";

import type { ReactNode } from "react";
import { AuthProvider } from "./AuthProvider";
import { DataProvider } from "./DataProvider";
import { HatcheryProvider } from "./HatcheryProvider";
import { LanguageProvider } from "./LanguageProvider";
import { OperatorProvider } from "./OperatorProvider";
import { ThemeProvider } from "./ThemeProvider";
import { ToastProvider } from "./ui/Toast";

/** Client-side context providers wrapping the whole app. */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <AuthProvider>
          <DataProvider>
            <HatcheryProvider>
              <OperatorProvider>
                <ToastProvider>{children}</ToastProvider>
              </OperatorProvider>
            </HatcheryProvider>
          </DataProvider>
        </AuthProvider>
      </LanguageProvider>
    </ThemeProvider>
  );
}
