// src/components/ui/sonner.tsx
"use client";
import { Toaster as Sonner } from "sonner";
import * as React from "react";

export function Toaster(props: React.ComponentProps<typeof Sonner>) {
  // Fija el tema según prefers-color-scheme o usa "light"
  const prefersDark = typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: dark)").matches;

  return (
    <Sonner
      theme={prefersDark ? "dark" : "light"}
      position="top-right"
      richColors
      closeButton
      {...props}
    />
  );
}
