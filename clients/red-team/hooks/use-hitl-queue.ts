"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchHitlQueue,
  overrideImageVariant,
  regenerateImageVariant,
  reviewImageVariant,
} from "@/lib/images/api";
import type { ImageScope, ImageVariant } from "@/lib/images/types";

type HitlFilters = {
  promptVersion?: string;
  model?: string;
  promptStrategy?: string;
  queueFilter?: string;
};

export function useHitlQueue(scope: ImageScope, filters: HitlFilters = {}) {
  const [queue, setQueue] = useState<ImageVariant[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const canLoad = Boolean(scope.subject && scope.phase && scope.theme && scope.capsule);

  const loadQueue = useCallback(async () => {
    if (!canLoad) return;
    setLoading(true);
    try {
      const data = await fetchHitlQueue(scope, {
        promptVersion: filters.promptVersion,
        model: filters.model,
        promptStrategy: filters.promptStrategy,
        queueFilter: filters.queueFilter || "pending",
        limit: 500,
      });
      setQueue(data.queue || []);
      setTotalCount(data.count || 0);
      setError("");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load HITL queue.");
    } finally {
      setLoading(false);
    }
  }, [canLoad, filters.promptVersion, filters.model, filters.promptStrategy, filters.queueFilter, scope]);

  useEffect(() => {
    if (!canLoad) return;
    loadQueue().catch(() => {});
  }, [canLoad, loadQueue]);

  const queueCounts = useMemo(() => {
    const pending = queue.filter(
      (v) => v.humanReviewStatus === "pending" || v.humanReviewStatus === undefined || v.decision === "REVIEW",
    ).length;
    const needsWork = queue.filter(
      (v) => v.humanReviewStatus === "needs_work" || v.decision === "REGENERATE",
    ).length;
    const approved = queue.filter(
      (v) => v.humanReviewStatus === "approve" || v.humanReviewStatus === "approved",
    ).length;
    return { total: totalCount, pending, needsWork, approved };
  }, [queue, totalCount]);

  const review = useCallback(
    async (variant: ImageVariant, action: "approve" | "reject" | "needs_work", note = "") => {
      await reviewImageVariant(variant.factId, variant.variantId, action, note);
      setQueue((prev) =>
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
    async (variant: ImageVariant, decision: "SHIP" | "REVIEW" | "REGENERATE", composite: number, note = "") => {
      await overrideImageVariant(variant.factId, variant.variantId, decision, composite, note);
      await loadQueue();
    },
    [loadQueue],
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
      await loadQueue();
    },
    [loadQueue, scope],
  );

  return {
    queue,
    queueCounts,
    loading,
    error,
    loadQueue,
    review,
    override,
    regenerate,
  };
}
