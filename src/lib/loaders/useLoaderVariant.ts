"use client";
import { useCallback, useEffect, useState } from "react";
import {
  CURVE_VARIANTS,
  DEFAULT_LOADER_VARIANT,
  LOADER_VARIANT_STORAGE_KEY,
  resolveLoaderVariant,
  type CurveLoaderVariant,
} from "./curveVariants";

export function useLoaderVariant() {
  const [variant, setVariantState] = useState<CurveLoaderVariant>(DEFAULT_LOADER_VARIANT);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(LOADER_VARIANT_STORAGE_KEY);
    setVariantState(resolveLoaderVariant(stored));
    setReady(true);
  }, []);

  const setVariant = useCallback((next: CurveLoaderVariant) => {
    setVariantState(next);
    localStorage.setItem(LOADER_VARIANT_STORAGE_KEY, next);
  }, []);

  const definition = CURVE_VARIANTS[variant];

  return { variant, setVariant, definition, ready };
}
