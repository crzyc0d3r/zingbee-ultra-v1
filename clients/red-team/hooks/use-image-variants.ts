"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchImageVariants,
  overrideImageVariant,
  regenerateImageVariant,
  reviewImageVariant,
} from "@/lib/images/api";
import type { ImageScope, ImageVariant } from "@/lib/images/types";

type VariantFilters = {
  promptVersion?: string;
  model?: string;
  promptStrategy?: string;
};

export function useImageVariants(scope: ImageScope, filters: VariantFilters = {}) {
  const [variants, setVariants] = useState<ImageVariant[]>([]);
  const [error, setError] = useState("");

  const canLoad = Boolean(scope.subject && scope.phase && scope.theme && scope.capsule);

  const loadVariants = useCallback(async () => {
    if (!canLoad) return;
    const data = await fetchImageVariants(scope, filters);
    setVariants(data.variants || []);
  }, [canLoad, filters, scope]);

  useEffect(() => {
    if (!canLoad) return;
    loadVariants().catch((e: unknown) => {
      setError(e instanceof Error ? e.message : "Failed to load variants.");
    });
  }, [canLoad, loadVariants]);

  const groupedVariants = useMemo(() => {
    const groups: Record<string, ImageVariant[]> = {};
    for (const v of variants) {
      const key = `${v.provider || "unknown"}:${v.model || "unknown"}|${v.promptStrategy || "baseline"}|${v.promptVersion || "-"}`;
      groups[key] = groups[key] || [];
      groups[key].push(v);
    }
    return Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
  }, [variants]);

  const summary = useMemo(() => {
    const total = variants.length;
    const ship = variants.filter((v) => v.decision === "SHIP").length;
    const review = variants.filter((v) => v.decision === "REVIEW").length;
    const regen = variants.filter((v) => v.decision === "REGENERATE").length;
    const byCombo: Record<string, number> = {};
    for (const v of variants) {
      const key = `${v.provider || "unknown"}:${v.model || "unknown"}|${v.promptStrategy || "baseline"}|${v.promptVersion || "-"}`;
      byCombo[key] = (byCombo[key] || 0) + 1;
    }
    return { total, ship, review, regen, byCombo };
  }, [variants]);

  const review = useCallback(
    async (
      variant: ImageVariant,
      action: "approve" | "reject" | "needs_work",
      note = "",
    ) => {
      await reviewImageVariant(variant.factId, variant.variantId, action, note);
      setVariants((prev) =>
        prev.map((v) =>
          v.factId === variant.factId && v.variantId === variant.variantId
            ? { ...v, humanReviewStatus: action }
            : v,
        ),
      );
    },
    [],
  );

  const override = useCallback(
    async (
      variant: ImageVariant,
      decision: "SHIP" | "REVIEW" | "REGENERATE",
      composite: number,
      note = "",
    ) => {
      await overrideImageVariant(
        variant.factId,
        variant.variantId,
        decision,
        composite,
        note,
      );
      await loadVariants();
    },
    [loadVariants],
  );

  const regenerate = useCallback(
    async (variant: ImageVariant, nextPromptVersion?: string) => {
      await regenerateImageVariant(variant.factId, variant.variantId, {
        subject: scope.subject,
        phase: scope.phase,
        theme: scope.theme,
        capsule: scope.capsule,
        next_prompt_version: nextPromptVersion || undefined,
      });
      await loadVariants();
    },
    [loadVariants, scope],
  );

  return {
    variants,
    setVariants,
    groupedVariants,
    summary,
    error,
    setError,
    loadVariants,
    review,
    override,
    regenerate,
  };
}
