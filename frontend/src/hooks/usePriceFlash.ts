"use client";

import { useEffect, useRef, useState } from "react";

export const FLASH_MS = 500;

/**
 * Returns a flash class ("flash-up" | "flash-down" | "") that is set when `price` changes and
 * cleared after FLASH_MS, plus a key that increments per tick so the CSS animation restarts.
 */
export function usePriceFlash(price: number | null | undefined) {
  const prev = useRef<number | null | undefined>(price);
  const [flash, setFlash] = useState<{ cls: string; key: number }>({ cls: "", key: 0 });

  useEffect(() => {
    const before = prev.current;
    prev.current = price;
    if (price === null || price === undefined || before === null || before === undefined || price === before) return;
    const cls = price > before ? "flash-up" : "flash-down";
    setFlash((f) => ({ cls, key: f.key + 1 }));
    const t = setTimeout(() => setFlash((f) => ({ ...f, cls: "" })), FLASH_MS);
    return () => clearTimeout(t);
  }, [price]);

  return flash;
}
