import { useCallback, useEffect, useState } from "react";
import { fetchPipelineHealth } from "@/lib/distillations/api";
import type { PipelineHealthSummary } from "@/lib/distillations/types";

type Filters = {
  subject?: string;
  phase?: number;
  drilldown?: "subject" | "phase";
};

export function usePipelineHealth(filters?: Filters) {
  const [data, setData] = useState<PipelineHealthSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await fetchPipelineHealth(filters);
      setData(result);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load pipeline health");
    } finally {
      setLoading(false);
    }
  }, [filters?.subject, filters?.phase, filters?.drilldown]);

  useEffect(() => { load(); }, [load]);

  return { data, loading, error, reload: load };
}
