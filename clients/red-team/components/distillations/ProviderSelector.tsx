"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { apiFetch } from "@/lib/api";

// --- Types ---

type ModelInfo = {
  id: string;
  name: string;
  available: boolean;
};

type ProviderStatus = {
  vllm: {
    online: boolean;
    text_gen: ModelInfo[];
    text_eval: ModelInfo[];
  };
  ollama: {
    online: boolean;
    models: ModelInfo[];
  };
  xai: {
    online: boolean;
    image: boolean;
  };
  google: {
    online: boolean;
    vertex: boolean;
  };
};

export type ModelSelection = {
  generationModel: string;
  evaluationModel: string;
  imageProvider: string;
};

type ProviderSelectorProps = {
  value: ModelSelection;
  onChange: (selection: ModelSelection) => void;
};

// --- Helpers ---

function StatusDot({ available }: { available: boolean }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: available ? "#22c55e" : "#ef4444",
        flexShrink: 0,
        marginRight: 6,
      }}
      aria-label={available ? "Available" : "Unavailable"}
    />
  );
}

// --- Component ---

export function ProviderSelector({ value, onChange }: ProviderSelectorProps) {
  const [providers, setProviders] = useState<ProviderStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadProviders = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch<ProviderStatus>("/distillations/api/providers");
      setProviders(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load providers");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProviders();
  }, [loadProviders]);

  // Build options lists (memoized so auto-select effect can use them)
  const { genModels, evalModels, imageProviders } = useMemo(() => {
    const gen: { id: string; name: string; available: boolean }[] = [];
    const ev: { id: string; name: string; available: boolean }[] = [];
    const img: { id: string; name: string; available: boolean }[] = [];
    if (providers) {
      for (const m of providers.vllm.text_gen) {
        gen.push({ id: m.id, name: m.name, available: providers.vllm.online && m.available });
      }
      gen.push({ id: "xai-frontier", name: "xAI Frontier", available: providers.xai.online });
      gen.push({ id: "google-frontier", name: "Google Frontier", available: providers.google.online });

      for (const m of providers.vllm.text_eval) {
        ev.push({ id: m.id, name: m.name, available: providers.vllm.online && m.available });
      }
      ev.push({ id: "xai-frontier", name: "xAI Frontier", available: providers.xai.online });
      ev.push({ id: "google-frontier", name: "Google Frontier", available: providers.google.online });

      if (providers.xai.image) img.push({ id: "xai", name: "xAI Grok", available: providers.xai.online });
      if (providers.google.online) img.push({ id: "google", name: "Google Imagen", available: providers.google.online });
      if (providers.google.vertex) img.push({ id: "vertex", name: "Vertex AI", available: true });
    }
    return { genModels: gen, evalModels: ev, imageProviders: img };
  }, [providers]);

  // Auto-select first available model after providers load (runs once per list refresh)
  const autoSelectedRef = useRef(false);
  useEffect(() => {
    if (autoSelectedRef.current) return;
    if (genModels.length === 0 && evalModels.length === 0) return;
    const firstGen = genModels.find((m) => m.available);
    const firstEval = evalModels.find((m) => m.available);
    const firstImage = imageProviders.find((m) => m.available);
    const update: Partial<ModelSelection> = {};
    if (firstGen) update.generationModel = firstGen.id;
    if (firstEval) update.evaluationModel = firstEval.id;
    if (firstImage) update.imageProvider = firstImage.id;
    if (Object.keys(update).length > 0) {
      autoSelectedRef.current = true;
      onChange({ generationModel: "", evaluationModel: "", imageProvider: "xai", ...update });
    }
  }, [genModels, evalModels, imageProviders, onChange]);

  return (
    <div style={{
      display: "flex",
      flexWrap: "wrap",
      gap: 10,
      alignItems: "flex-end",
      padding: "8px 0",
    }}>
      {/* Generation Model */}
      <div className="images-control">
        <label htmlFor="provider-gen-model">Generation Model</label>
        <div style={{ display: "flex", alignItems: "center" }}>
          <StatusDot available={genModels.find((m) => m.id === value.generationModel)?.available ?? false} />
          <select
            id="provider-gen-model"
            value={value.generationModel}
            onChange={(e) => onChange({ ...value, generationModel: e.target.value })}
            disabled={loading || !providers}
            style={{
              background: "#0f172a",
              color: "#e2e8f0",
              border: "1px solid #334155",
              borderRadius: 6,
              padding: "7px 10px",
              fontSize: 12,
              fontFamily: "inherit",
              minWidth: 160,
            }}
          >
            {genModels.length === 0 && <option value="">Loading...</option>}
            {genModels.map((m) => (
              <option key={m.id} value={m.id} disabled={!m.available}>
                {m.name}{!m.available ? " (offline)" : ""}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Evaluation Model */}
      <div className="images-control">
        <label htmlFor="provider-eval-model">Evaluation Model</label>
        <div style={{ display: "flex", alignItems: "center" }}>
          <StatusDot available={evalModels.find((m) => m.id === value.evaluationModel)?.available ?? false} />
          <select
            id="provider-eval-model"
            value={value.evaluationModel}
            onChange={(e) => onChange({ ...value, evaluationModel: e.target.value })}
            disabled={loading || !providers}
            style={{
              background: "#0f172a",
              color: "#e2e8f0",
              border: "1px solid #334155",
              borderRadius: 6,
              padding: "7px 10px",
              fontSize: 12,
              fontFamily: "inherit",
              minWidth: 160,
            }}
          >
            {evalModels.length === 0 && <option value="">Loading...</option>}
            {evalModels.map((m) => (
              <option key={m.id} value={m.id} disabled={!m.available}>
                {m.name}{!m.available ? " (offline)" : ""}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Image Provider */}
      <div className="images-control">
        <label htmlFor="provider-image">Image Provider</label>
        <div style={{ display: "flex", alignItems: "center" }}>
          <StatusDot available={imageProviders.find((m) => m.id === value.imageProvider)?.available ?? false} />
          <select
            id="provider-image"
            value={value.imageProvider}
            onChange={(e) => onChange({ ...value, imageProvider: e.target.value })}
            disabled={loading || !providers}
            style={{
              background: "#0f172a",
              color: "#e2e8f0",
              border: "1px solid #334155",
              borderRadius: 6,
              padding: "7px 10px",
              fontSize: 12,
              fontFamily: "inherit",
              minWidth: 140,
            }}
          >
            {imageProviders.length === 0 && <option value="">Loading...</option>}
            {imageProviders.map((m) => (
              <option key={m.id} value={m.id} disabled={!m.available}>
                {m.name}{!m.available ? " (offline)" : ""}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Refresh */}
      <button
        onClick={loadProviders}
        disabled={loading}
        title="Refresh provider status"
        style={{
          background: "#0f172a",
          color: "#e2e8f0",
          border: "1px solid #334155",
          borderRadius: 6,
          padding: "7px 10px",
          fontSize: 12,
          fontFamily: "inherit",
          cursor: loading ? "not-allowed" : "pointer",
          transition: "all 0.15s ease",
          opacity: loading ? 0.5 : 1,
        }}
      >
        <Icon name="refresh" /> {loading ? "..." : "Refresh"}
      </button>

      {/* Error */}
      {error && (
        <span style={{ fontSize: 11, color: "#fecaca" }}>{error}</span>
      )}
    </div>
  );
}
