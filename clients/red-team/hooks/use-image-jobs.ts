"use client";

import { useCallback, useEffect, useState } from "react";
import {
  cancelImageJob,
  fetchImageJobDetail,
  fetchImageJobs,
  startImageCommand,
} from "@/lib/images/api";
import type { ImageCommand } from "@/lib/images/constants";
import type { ImageJob, ImageJobDetail, ImageScope } from "@/lib/images/types";

export function useImageJobs() {
  const [jobs, setJobs] = useState<ImageJob[]>([]);
  const [monitoredJobId, setMonitoredJobId] = useState("");
  const [jobDetail, setJobDetail] = useState<ImageJobDetail | null>(null);
  const [runningCommand, setRunningCommand] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadJobs = useCallback(async () => {
    const data = await fetchImageJobs();
    setJobs(data.jobs || []);
  }, []);

  const loadJobDetail = useCallback(async (jobId: string) => {
    if (!jobId) return;
    const detail = await fetchImageJobDetail(jobId);
    setJobDetail(detail);
  }, []);

  const runCommand = useCallback(
    async (
      command: ImageCommand,
      scope: ImageScope,
      options: Record<string, unknown>,
      onStarted?: (jobId: string) => Promise<void> | void,
    ) => {
      setError("");
      setLoading(true);
      setRunningCommand(command);
      try {
        const started = await startImageCommand(command, scope, options);
        if (started?.jobId) {
          setMonitoredJobId(started.jobId);
          await loadJobDetail(started.jobId);
          if (onStarted) await onStarted(started.jobId);
        }
        await loadJobs();
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Failed to start command.");
      } finally {
        setLoading(false);
        setRunningCommand("");
      }
    },
    [loadJobDetail, loadJobs],
  );

  const cancelJob = useCallback(
    async (jobId: string) => {
      if (!jobId) return;
      try {
        await cancelImageJob(jobId);
        if (jobDetail?.id === jobId) {
          await loadJobDetail(jobId);
        }
        await loadJobs();
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Failed to cancel job.");
      }
    },
    [jobDetail?.id, loadJobDetail, loadJobs],
  );

  useEffect(() => {
    loadJobs().catch((e: unknown) => {
      setError(e instanceof Error ? e.message : "Failed to load image jobs.");
    });
    const timer = setInterval(() => {
      loadJobs().catch(() => {});
    }, 5000);
    return () => clearInterval(timer);
  }, [loadJobs]);

  useEffect(() => {
    if (!monitoredJobId) return;
    loadJobDetail(monitoredJobId).catch((e: unknown) => {
      setError(e instanceof Error ? e.message : "Failed to load job detail.");
    });
    const timer = setInterval(() => {
      loadJobDetail(monitoredJobId).catch(() => {});
    }, 2500);
    return () => clearInterval(timer);
  }, [monitoredJobId, loadJobDetail]);

  return {
    jobs,
    monitoredJobId,
    setMonitoredJobId,
    jobDetail,
    runningCommand,
    loading,
    error,
    setError,
    loadJobs,
    loadJobDetail,
    runCommand,
    cancelJob,
  };
}
