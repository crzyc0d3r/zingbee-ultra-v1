"use client";

import { Suspense, useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { apiFetch } from "@/lib/api";
import { useToast, ToastProvider } from "@/components/ui/Toast";
import { SvgSprite, Icon } from "@/components/ui/Icon";
import { LoginOverlay } from "@/components/layout/LoginOverlay";
import { RunsList } from "@/components/evals/RunsList";
import { RunDetail } from "@/components/evals/RunDetail";
import { JobsList } from "@/components/evals/JobsList";
import { JobDetail } from "@/components/evals/JobDetail";
import { NewJobForm } from "@/components/evals/NewJobForm";
import "@/styles/evals.css";

type View =
  | { kind: "jobs" }
  | { kind: "runs" }
  | { kind: "runDetail"; runId: string }
  | { kind: "jobDetail"; jobId: string };

function EvalsPageInner() {
  const { user, loading: authLoading } = useAuth();
  const searchParams = useSearchParams();
  const { toast } = useToast();

  const isEmbed = searchParams.get("embed") === "1";
  const initView = searchParams.get("view");

  // Default view based on URL param: "completed" -> runs, otherwise jobs
  const [view, setView] = useState<View>(
    initView === "completed" ? { kind: "runs" } : { kind: "jobs" }
  );
  const [allRuns, setAllRuns] = useState<any[]>([]);
  const [allJobs, setAllJobs] = useState<any[]>([]);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [newJobOpen, setNewJobOpen] = useState(false);
  const [search, setSearch] = useState("");

  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load runs + jobs
  const loadData = useCallback(async () => {
    const [runsResult, jobsResult] = await Promise.allSettled([
      apiFetch<{ runs: any[] }>("/evals/api/runs"),
      apiFetch<{ jobs: any[] }>("/evals/api/jobs"),
    ]);
    if (runsResult.status === "fulfilled") {
      setAllRuns(runsResult.value.runs || []);
    } else if (runsResult.reason?.message !== "auth") {
      toast("Failed to load runs", "error");
    }
    if (jobsResult.status === "fulfilled") {
      setAllJobs(jobsResult.value.jobs || []);
    } else if (jobsResult.reason?.message !== "auth") {
      toast("Failed to load jobs", "error");
    }
    setDataLoaded(true);
  }, [toast]);

  // Initial data load
  useEffect(() => {
    if (!user) return;
    loadData();
  }, [user, loadData]);

  // Handle embed ?view=new
  useEffect(() => {
    if (!dataLoaded) return;
    if (initView === "new") setNewJobOpen(true);
  }, [dataLoaded, initView]);

  // Auto-refresh when on jobs view (for running jobs)
  useEffect(() => {
    if (view.kind === "jobs") {
      refreshTimerRef.current = setInterval(async () => {
        await loadData();
      }, 10000);
    }
    return () => {
      if (refreshTimerRef.current) {
        clearInterval(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [view.kind, loadData]);

  // Cancel a job
  const handleCancelJob = async (jobId: string) => {
    try {
      await apiFetch(`/evals/api/jobs/${encodeURIComponent(jobId)}/cancel`, {
        method: "POST",
      });
      toast("Job cancelled", "success");
      await loadData();
    } catch {
      // handled
    }
  };

  // Delete a job
  const handleDeleteJob = async (jobId: string) => {
    try {
      await apiFetch(`/evals/api/jobs/${encodeURIComponent(jobId)}`, {
        method: "DELETE",
      });
      toast("Job deleted", "success");
      await loadData();
    } catch (e: any) {
      toast(e.message || "Failed to delete job", "error");
    }
  };

  // Delete a completed run
  const handleDeleteRun = async (runId: string) => {
    try {
      await apiFetch(`/evals/api/runs/${encodeURIComponent(runId)}`, {
        method: "DELETE",
      });
      toast("Run deleted", "success");
      await loadData();
    } catch (e: any) {
      toast(e.message || "Failed to delete run", "error");
    }
  };

  // Debounced search
  const [activeSearch, setActiveSearch] = useState("");
  const handleSearchInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearch(val);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setActiveSearch(val.toLowerCase());
    }, 300);
  }, []);

  // Filter based on current view
  const filteredJobs = activeSearch
    ? allJobs.filter((j: any) =>
        j.id?.toLowerCase().includes(activeSearch) ||
        j.status?.toLowerCase().includes(activeSearch) ||
        j.config?.toLowerCase().includes(activeSearch) ||
        j.persona?.toLowerCase().includes(activeSearch) ||
        j.targets?.some((t: string) => t.toLowerCase().includes(activeSearch))
      )
    : allJobs;

  const filteredRuns = activeSearch
    ? allRuns.filter((r: any) =>
        r.id?.toLowerCase().includes(activeSearch) ||
        r.config?.toLowerCase().includes(activeSearch) ||
        r.subjects?.some((s: string) => s.toLowerCase().includes(activeSearch))
      )
    : allRuns;

  // Toolbar title based on view
  const toolbarTitle =
    view.kind === "jobs" || view.kind === "jobDetail"
      ? "Jobs"
      : "Completed Runs";

  // Is this a list view (grid fills viewport) or detail view (scrollable)?
  const isListView = view.kind === "jobs" || view.kind === "runs";

  // Auth guard
  if (authLoading) {
    return (
      <div className="page-evals">
        <div className="empty">
          <div className="ico"><Icon name="hourglass" size={32} /></div>
          <div>Loading...</div>
        </div>
      </div>
    );
  }

  if (!user) {
    return <div className="page-evals"><LoginOverlay /></div>;
  }

  return (
    <div className="page-evals">
      <SvgSprite />

      {/* Toolbar - title left, search + button right */}
      <div className="toolbar">
        <span className="toolbar-title">{toolbarTitle}</span>
        <div className="toolbar-actions">
          <input
            type="text"
            placeholder="Search..."
            value={search}
            onChange={handleSearchInput}
          />
          {(view.kind === "jobs" || view.kind === "jobDetail") && (
            <button
              className="btn btn-primary"
              onClick={() => setNewJobOpen(true)}
            >
              <Icon name="plus" /> New Job
            </button>
          )}
        </div>
      </div>

      {/* Content area */}
      <div className={`app${isEmbed ? " embed-mode" : ""}`}>
        <div className="main">
          {isListView ? (
            <div className="content">
              {!dataLoaded ? (
                <div className="empty">
                  <div className="ico"><Icon name="hourglass" size={32} /></div>
                  <div>Loading...</div>
                </div>
              ) : view.kind === "jobs" ? (
                <JobsList
                  jobs={filteredJobs}
                  onJobClick={(id) => setView({ kind: "jobDetail", jobId: id })}
                  onCancelJob={handleCancelJob}
                  onDeleteJob={handleDeleteJob}
                />
              ) : (
                <RunsList
                  runs={filteredRuns}
                  onRunClick={(id) => setView({ kind: "runDetail", runId: id })}
                  onDeleteRun={handleDeleteRun}
                />
              )}
            </div>
          ) : (
            <div className="content-scroll">
              {view.kind === "runDetail" ? (
                <RunDetail
                  runId={view.runId}
                  onBack={() => setView({ kind: "runs" })}
                />
              ) : view.kind === "jobDetail" ? (
                <JobDetail
                  jobId={view.jobId}
                  onBack={() => setView({ kind: "jobs" })}
                />
              ) : null}
            </div>
          )}
        </div>
      </div>

      {/* New Job modal */}
      <NewJobForm
        open={newJobOpen}
        onClose={() => setNewJobOpen(false)}
        onCreated={async () => {
          await loadData();
          setView({ kind: "jobs" });
        }}
      />
    </div>
  );
}

export default function EvalsPage() {
  return (
    <ToastProvider>
      <Suspense>
        <EvalsPageInner />
      </Suspense>
    </ToastProvider>
  );
}
