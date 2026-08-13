"use client";

import { Suspense, useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { apiFetch } from "@/lib/api";
import type { SessionListItem } from "@/lib/types";
import { SvgSprite, Icon } from "@/components/ui/Icon";
import { LoginOverlay } from "@/components/layout/LoginOverlay";
import { useToast, ToastProvider } from "@/components/ui/Toast";
import SessionFilters from "@/components/sessions/SessionFilters";
import SessionList from "@/components/sessions/SessionList";
import SessionDetail from "@/components/sessions/SessionDetail";
import Lightbox from "@/components/sessions/Lightbox";
import "@/styles/sessions.css";

const LIMIT = 50;

interface SessionListResponse {
  sessions: SessionListItem[];
  total: number;
}

function SessionsPageInner() {
  const { user, loading } = useAuth();
  const searchParams = useSearchParams();
  const isEmbed = searchParams.get("embed") === "1";
  const { toast } = useToast();

  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  // Sort state (server-side)
  const [orderBy, setOrderBy] = useState<string | null>("start_time");
  const [orderDir, setOrderDir] = useState<"ASC" | "DESC">("DESC");

  // Filter state managed by parent so we can trigger reloads
  const filterRef = useRef<{ studentId: string; search: string }>({
    studentId: "",
    search: "",
  });

  // Build URL with all params
  const buildUrl = useCallback(
    (off: number, ob: string | null, od: "ASC" | "DESC") => {
      const { studentId, search } = filterRef.current;
      let url = `/sessions/api/list?limit=${LIMIT}&offset=${off}`;
      if (studentId) url += `&student_id=${encodeURIComponent(studentId)}`;
      if (search) url += `&search=${encodeURIComponent(search)}`;
      if (ob) url += `&order_by=${encodeURIComponent(ob)}&order_dir=${od}`;
      return url;
    },
    [],
  );

  // Load sessions
  const loadSessions = useCallback(async () => {
    const url = buildUrl(offset, orderBy, orderDir);
    try {
      setError(false);
      const data = await apiFetch<SessionListResponse>(url);
      setTotal(data.total);
      setSessions(data.sessions);
    } catch {
      setError(true);
      setSessions([]);
    }
  }, [offset, orderBy, orderDir, buildUrl]);

  useEffect(() => {
    if (!loading && user) {
      loadSessions();
    }
  }, [loading, user, loadSessions]);

  // Auth redirect
  useEffect(() => {
    if (!loading && !user) {
      // LoginOverlay handles the UI
    }
  }, [loading, user]);

  const handleFilterChange = useCallback(
    (studentId: string, search: string) => {
      filterRef.current = { studentId, search };
      setOffset(0);
      // Trigger reload with current sort params
      const loadFn = async () => {
        let url = `/sessions/api/list?limit=${LIMIT}&offset=0`;
        if (studentId) url += `&student_id=${encodeURIComponent(studentId)}`;
        if (search) url += `&search=${encodeURIComponent(search)}`;
        if (orderBy) url += `&order_by=${encodeURIComponent(orderBy)}&order_dir=${orderDir}`;
        try {
          setError(false);
          const data = await apiFetch<SessionListResponse>(url);
          setTotal(data.total);
          setSessions(data.sessions);
        } catch {
          setError(true);
          setSessions([]);
        }
      };
      loadFn();
    },
    [orderBy, orderDir],
  );

  const handleSort = useCallback(
    (col: string, dir: "ASC" | "DESC") => {
      setOrderBy(col);
      setOrderDir(dir);
      setOffset(0);
    },
    [],
  );

  const handleSelectSession = useCallback((id: string) => {
    setCurrentSessionId(id);
  }, []);

  const handleCloseDetail = useCallback(() => {
    setCurrentSessionId(null);
  }, []);

  const handlePrev = useCallback(() => {
    setOffset((prev) => Math.max(0, prev - LIMIT));
  }, []);

  const handleNext = useCallback(() => {
    setOffset((prev) => prev + LIMIT);
  }, []);

  const handleImageClick = useCallback((url: string) => {
    setLightboxUrl(url);
  }, []);

  const handleLightboxClose = useCallback(() => {
    setLightboxUrl(null);
  }, []);

  const handleDeleteSession = useCallback(async (sessionId: string) => {
    try {
      await apiFetch(`/sessions/api/${encodeURIComponent(sessionId)}`, {
        method: "DELETE",
      });
      toast("Session deleted", "success");
      if (currentSessionId === sessionId) setCurrentSessionId(null);
      await loadSessions();
    } catch (e: any) {
      toast(e.message || "Failed to delete session", "error");
    }
  }, [currentSessionId, loadSessions, toast]);

  // Apply embed mode class
  useEffect(() => {
    if (isEmbed) {
      document.body.classList.add("embed-mode");
      return () => document.body.classList.remove("embed-mode");
    }
  }, [isEmbed]);

  // Apply detail-open class to body when detail is showing
  useEffect(() => {
    if (currentSessionId) {
      document.body.classList.add("detail-open");
    } else {
      document.body.classList.remove("detail-open");
    }
    return () => document.body.classList.remove("detail-open");
  }, [currentSessionId]);

  // Show login overlay if not authenticated
  if (!loading && !user) {
    return (
      <div className="page-sessions">
        <SvgSprite />
        <LoginOverlay />
      </div>
    );
  }

  return (
    <div className="page-sessions">
      <SvgSprite />

      <SessionFilters
        onFilterChange={handleFilterChange}
        sessionCount={total}
      />

      {error ? (
        <div className="data-grid">
          <div className="table-wrap">
            <div className="empty">
              <div className="ico">
                <Icon name="warning" size={32} />
              </div>
              <div style={{ color: "#ef4444" }}>Error loading sessions</div>
            </div>
          </div>
        </div>
      ) : (
        <SessionList
          sessions={sessions}
          currentSessionId={currentSessionId}
          onSelect={handleSelectSession}
          onDelete={handleDeleteSession}
          serverPagination={{
            total,
            offset,
            pageSize: LIMIT,
            onPrev: handlePrev,
            onNext: handleNext,
            onSort: handleSort,
            orderBy,
            orderDir,
          }}
        />
      )}

      {/* Detail panel */}
      {currentSessionId && (
        <SessionDetail
          sessionId={currentSessionId}
          onClose={handleCloseDetail}
          onImageClick={handleImageClick}
        />
      )}

      {/* Lightbox */}
      <Lightbox url={lightboxUrl} onClose={handleLightboxClose} />
    </div>
  );
}

export default function SessionsPage() {
  return (
    <ToastProvider>
      <Suspense>
        <SessionsPageInner />
      </Suspense>
    </ToastProvider>
  );
}
