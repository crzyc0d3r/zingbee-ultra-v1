"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import "@/styles/chat.css";

import { useAuth } from "@/lib/auth";
import { apiFetch } from "@/lib/api";
import type { SubjectEntry } from "@/components/chat/SubjectGrid";
import { useChatStream } from "@/hooks/use-chat-stream";
import { useSessionTimer } from "@/hooks/use-session-timer";
import { useXAIVoice } from "@/hooks/use-xai-voice";

import { SvgSprite } from "@/components/ui/Icon";
import { LoginOverlay } from "@/components/layout/LoginOverlay";
import { NavSidebar } from "@/components/layout/NavSidebar";
import { StartScreen } from "@/components/chat/StartScreen";
import type { SessionMode } from "@/components/chat/StartScreen";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { ChatInput } from "@/components/chat/ChatInput";
import { ExecPanel } from "@/components/chat/ExecPanel";
import { VocabBankPanel } from "@/components/chat/VocabBankPanel";
import { EndSessionPanel } from "@/components/chat/EndSessionPanel";
import { FeedbackModal } from "@/components/chat/FeedbackModal";
import { ExecDetailsModal } from "@/components/chat/ExecDetailsModal";
import { StudentDetailsModal } from "@/components/chat/StudentDetailsModal";
import { CurriculumModal } from "@/components/chat/CurriculumModal";

type ViewMode = "start" | "chat" | "ended";

export default function ChatPage() {
  const { user, loading: authLoading } = useAuth();

  // --- Core state ---
  const [currentSubject, setCurrentSubject] = useState("Biology");
  const [viewMode, setViewMode] = useState<ViewMode>("start");
  const [showContinue, setShowContinue] = useState(false);

  // --- Iframe navigation ---
  const [iframeMode, setIframeMode] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // --- Toast ---
  const [toasts, setToasts] = useState<{ id: number; message: string; type: string }[]>([]);
  const toastIdRef = useRef(0);
  const showToast = useCallback((message: string, type: string = "info") => {
    const id = toastIdRef.current++;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3000);
  }, []);

  // --- Chat stream ---
  const chatStream = useChatStream();
  const {
    messages,
    execLog,
    streaming,
    waitingForImage,
    thinkingLabel,
    factsState,
    totalFacts,
    tokenCount,
    questionsAsked,
    correctAnswers,
    suggestions,
    currentPhase,
    endSessionData,
    vocabBank,
    definitionsHidden,
    fetchGreeting,
    sendMessage: streamSend,
    resetState: resetChatState,
  } = chatStream;

  // --- Timer ---
  const timer = useSessionTimer();

  // --- Voice ---
  const voice = useXAIVoice();

  // --- Feedback ---
  const [feedbackSentMap, setFeedbackSentMap] = useState<Record<number, boolean>>({});
  const [feedbackModalOpen, setFeedbackModalOpen] = useState(false);
  const [feedbackMsgIndex, setFeedbackMsgIndex] = useState<number>(0);
  const [feedbackMsgPreview, setFeedbackMsgPreview] = useState("");
  const [feedbackInitialSentiment, setFeedbackInitialSentiment] = useState("positive");

  // --- Modals ---
  const [studentDetailsOpen, setStudentDetailsOpen] = useState(false);
  const [curriculumOpen, setCurriculumOpen] = useState(false);
  const [execDetailsOpen, setExecDetailsOpen] = useState(false);
  const [execDetailsEntry, setExecDetailsEntry] = useState<{ step: string; details: string; agent?: string; timestamp?: string } | null>(null);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [newSessionConfirmOpen, setNewSessionConfirmOpen] = useState(false);
  const [pendingSimValues, setPendingSimValues] = useState<{
    phase: number; step: number; theme: string; capsule: string; factIndex: number;
  } | null>(null);
  const [hasProgress, setHasProgress] = useState(false);
  const pendingModeRef = useRef<SessionMode>("text");

  // --- End session ---
  const [endSessionVisible, setEndSessionVisible] = useState(false);
  const [endData, setEndData] = useState<any>(null);

  // --- Tutor selection ---
  const [tutors, setTutors] = useState<{ id: string; name: string; description: string }[]>([]);
  const [selectedTutorId, setSelectedTutorId] = useState<string | null>(null);

  // --- Subjects from DB ---
  const [subjectList, setSubjectList] = useState<SubjectEntry[]>([]);
  const [subjectTutorMap, setSubjectTutorMap] = useState<Record<string, string>>({});

  useEffect(() => {
    if (authLoading || !user) return;
    apiFetch<{ id: string; name: string; description: string }[]>("/api/tutors")
      .then(setTutors)
      .catch(() => {});
    apiFetch<{ subjects: Record<string, { tutor: string; phases: any[] }> }>("/api/subject-phases")
      .then((data) => {
        const entries: SubjectEntry[] = Object.entries(data.subjects).map(([name, info]) => ({ name, tutor: info.tutor }));
        setSubjectList(entries);
        const tMap: Record<string, string> = {};
        for (const [name, info] of Object.entries(data.subjects)) tMap[name] = info.tutor;
        setSubjectTutorMap(tMap);
      })
      .catch(() => {});
  }, [authLoading, user]);

  // --- Derived values ---
  const busy = streaming || waitingForImage;
  const studentId = user?.student_id || "";
  const students = user?.students || [];
  const tutorName = subjectTutorMap[currentSubject] || "Tutor";
  const subjectName = currentSubject;

  // --- Voice transcript + function call callbacks ---
  // Setters store into refs so they are stable — run once on mount
  useEffect(() => {
    voice.setOnUserTranscriptReady((text: string) => {
      chatStream.setMessages((prev) => [
        ...prev,
        { role: "user", content: text, showFeedback: false },
      ]);
    });
    voice.setOnAssistantTranscriptReady((text: string) => {
      chatStream.setMessages((prev) => [
        ...prev,
        { role: "assistant", content: text, showFeedback: true },
      ]);
    });

    voice.setOnProcessTurnResult((result: any) => {
      // Update ExecPanel
      if (result.execution_log?.length) {
        chatStream.setExecLog((prev) => [
          ...prev,
          ...result.execution_log.map((step: any) => ({
            step: step.step,
            details: step.details || {},
            agent: step.agent,
            timestamp: step.timestamp,
          })),
        ]);
      }
      // Update StatsBar facts
      if (result.facts_state) {
        chatStream.setFactsState({
          taught: result.facts_state.taught || 0,
          assessed: result.facts_state.assessed || 0,
          mastered: result.facts_state.mastered || 0,
        });
        if (result.facts_state.total) {
          chatStream.setTotalFacts(result.facts_state.total);
        }
      }
      // Update question/answer stats
      if (result.stats) {
        chatStream.setQuestionsAsked(result.stats.questions || 0);
        chatStream.setCorrectAnswers(result.stats.correct || 0);
      }
      // Update suggestions
      if (result.suggestions) {
        chatStream.setSuggestions(result.suggestions);
      }
      // Handle session end
      if (result.should_end_session) {
        voice.stopVoiceMode();
        chatStream.setEndSessionData({ should_end: true, ...result });
      }
    });

    voice.setOnImageGenerated((imageUrl: string, topic: string) => {
      chatStream.setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "",
          imageUrl,
          imageCaption: topic,
          showFeedback: false,
        },
      ]);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleVoiceStart = useCallback(async () => {
    if (!studentId) return;
    const hasMessages = messages.length > 0;

    // If no existing session, fetch greeting first to initialize backend session
    if (!hasMessages) {
      await fetchGreeting(studentId, currentSubject, selectedTutorId);
    }

    voice.startVoiceMode({ studentId, subject: currentSubject, skipGreeting: hasMessages });
  }, [studentId, currentSubject, selectedTutorId, voice, messages.length, fetchGreeting]);

  const handleVoiceStop = useCallback(() => {
    voice.stopVoiceMode();
  }, [voice]);

  // ----------------------------------------------------------------
  // View URLs for iframe navigation (matches original exactly)
  // ----------------------------------------------------------------
  const viewUrls: Record<string, string> = {
    sessions: "/sessions?embed=1",
    "evals-running": "/evals?embed=1",
    "evals-completed": "/evals?embed=1&view=completed",
    "evals-new": "/evals?embed=1&view=new",
    "admin-dashboard": "/admin?embed=1&table=__dashboard__",
    "admin-subjects": "/admin?embed=1&table=subjects",
    "admin-users": "/admin?embed=1&table=users",
    "admin-sessions": "/sessions?embed=1",
    "admin-tutors": "/admin?embed=1&table=tutors",
    "images-generate": "/distillations/review?embed=1&tab=images",
    "images-evaluation": "/distillations/review?embed=1&tab=images",
    "images-hitl": "/distillations/review?embed=1&tab=images",
    "distillations-dashboard": "/distillations/review?embed=1&tab=dashboard",
    "distillations-review": "/distillations/review?embed=1&tab=explanations",
    "distillations-images": "/distillations/review?embed=1&tab=images",
    "curriculum-audit": "/audits?embed=1",
    "curriculum-builder": "/curriculum-builder",
    "metaphor-review": "/metaphor-review?embed=1",
    playground: "/prompt-playground",
    "learning-system": "/learning-system",
    reporting: "/reporting?embed=1",
    "reporting-cost-student": "/reporting/cost-by-student?embed=1",
    "reporting-cost-workload": "/reporting/cost-by-workload?embed=1",
    "reporting-cost-model": "/reporting/cost-by-model?embed=1",
    "reporting-cost-subject": "/reporting/cost-by-subject?embed=1",
    "reporting-time-student": "/reporting/time-by-student?embed=1",
    "reporting-time-fact": "/reporting/time-by-fact?embed=1",
    "monitoring-engagement": "/monitoring/engagement?embed=1",
    logs: "/logs?embed=1",
  };

  // ----------------------------------------------------------------
  // NavSidebar iframe navigation handler
  // ----------------------------------------------------------------
  const handleNavTo = useCallback(
    (view: string) => {
      if (view === "app") {
        // Back to chat — hide iframe, show chat
        setIframeMode(false);
        if (iframeRef.current) {
          iframeRef.current.src = "";
          iframeRef.current.classList.remove("visible");
        }
      } else {
        // Load view in iframe
        const url = viewUrls[view];
        if (url && iframeRef.current) {
          setIframeMode(true);
          iframeRef.current.src = url;
          iframeRef.current.classList.add("visible");
        }
      }
    },
    [viewUrls]
  );

  // ----------------------------------------------------------------
  // Check session status on mount and when subject changes
  // ----------------------------------------------------------------
  const subjectInitialized = useRef(false);

  const checkSessionStatus = useCallback(
    async (subject: string) => {
      if (!studentId) return;
      try {
        const status = await apiFetch<{
          has_history: boolean;
          has_progress?: boolean;
          capsule_name?: string;
          last_subject?: string;
          subjects_with_progress?: string[];
        }>(
          `/api/student-status/${studentId}?subject=${encodeURIComponent(subject)}`
        );
        setShowContinue(!!(status.has_history && status.capsule_name));
        setHasProgress(!!status.has_progress);

        // On first load, switch to the student's last subject if available
        if (!subjectInitialized.current && status.last_subject) {
          subjectInitialized.current = true;
          if (status.last_subject !== subject) {
            setCurrentSubject(status.last_subject);
            // Re-check with the correct subject
            return;
          }
        }
        subjectInitialized.current = true;
      } catch {
        setShowContinue(false);
        setHasProgress(false);
      }
    },
    [studentId]
  );

  useEffect(() => {
    if (user && viewMode === "start") {
      checkSessionStatus(currentSubject);
    }
  }, [user, currentSubject, viewMode, checkSessionStatus]);

  // ----------------------------------------------------------------
  // Subject selection
  // ----------------------------------------------------------------
  const handleSelectSubject = useCallback(
    (subject: string) => {
      setCurrentSubject(subject);
      setShowContinue(false);
    },
    []
  );

  // ----------------------------------------------------------------
  // Start New Session (with progress warning gate)
  // ----------------------------------------------------------------
  const doStartNewSession = useCallback(
    async (simValues: {
      phase: number;
      step: number;
      theme: string;
      capsule: string;
      factIndex: number;
    }, mode: SessionMode = "text") => {
      if (!studentId) return;
      if (!simValues.theme || !simValues.capsule) {
        showToast("Please wait for curriculum to load", "error");
        return;
      }

      // Apply simulation settings (this resets student progress on the backend)
      try {
        const resp = await apiFetch<{ status: string; message?: string }>(
          "/api/simulate",
          {
            method: "POST",
            body: JSON.stringify({
              student_id: studentId,
              subject: currentSubject,
              phase: simValues.phase,
              step: simValues.step,
              theme: simValues.theme,
              capsule: simValues.capsule,
              fact_index: simValues.factIndex,
            }),
          }
        );
        if (resp.status !== "ok") {
          showToast(resp.message || "Simulation failed", "error");
          return;
        }
      } catch (e) {
        showToast(`Simulation error: ${e instanceof Error ? e.message : "unknown"}`, "error");
        return;
      }

      // Transition to chat view
      resetChatState();
      setFeedbackSentMap({});
      setEndSessionVisible(false);
      setEndData(null);
      setHasProgress(false);
      setViewMode("chat");
      timer.reset();
      timer.start();

      // Fetch greeting via the REST greeting endpoint (initializes backend session)
      await fetchGreeting(studentId, currentSubject, selectedTutorId);

      // If voice mode selected, start voice after greeting is ready
      if (mode === "voice") {
        voice.startVoiceMode({ studentId, subject: currentSubject, skipGreeting: false });
      }
    },
    [studentId, currentSubject, selectedTutorId, resetChatState, fetchGreeting, timer, showToast, voice]
  );

  const handleStartNew = useCallback(
    (simValues: {
      phase: number;
      step: number;
      theme: string;
      capsule: string;
      factIndex: number;
    }, mode: SessionMode = "text") => {
      if (!studentId) return;
      if (hasProgress) {
        setPendingSimValues(simValues);
        pendingModeRef.current = mode;
        setNewSessionConfirmOpen(true);
        return;
      }
      doStartNewSession(simValues, mode);
    },
    [studentId, hasProgress, doStartNewSession]
  );

  const handleNewSessionConfirm = useCallback(() => {
    setNewSessionConfirmOpen(false);
    if (pendingSimValues) {
      doStartNewSession(pendingSimValues, pendingModeRef.current);
      setPendingSimValues(null);
    }
  }, [pendingSimValues, doStartNewSession]);

  // ----------------------------------------------------------------
  // Continue Session (use DB position as-is)
  // ----------------------------------------------------------------
  const handleContinue = useCallback(async (mode: SessionMode = "text") => {
    if (!studentId) return;

    resetChatState();
    setFeedbackSentMap({});
    setEndSessionVisible(false);
    setEndData(null);
    setViewMode("chat");
    timer.reset();
    timer.start();

    // Fetch greeting via the REST greeting endpoint (initializes backend session)
    await fetchGreeting(studentId, currentSubject, selectedTutorId);

    // If voice mode selected, start voice after greeting is ready
    if (mode === "voice") {
      voice.startVoiceMode({ studentId, subject: currentSubject, skipGreeting: false });
    }
  }, [studentId, currentSubject, selectedTutorId, resetChatState, fetchGreeting, timer, voice]);

  // ----------------------------------------------------------------
  // Send message
  // ----------------------------------------------------------------
  const handleSend = useCallback(
    (text: string) => {
      if (!studentId || busy) return;
      streamSend(studentId, text, currentSubject);
    },
    [studentId, busy, currentSubject, streamSend]
  );

  // ----------------------------------------------------------------
  // Suggestion select - send that text as a message
  // ----------------------------------------------------------------
  const handleSuggestionSelect = useCallback(
    (text: string) => {
      handleSend(text);
    },
    [handleSend]
  );

  // ----------------------------------------------------------------
  // End Session
  // ----------------------------------------------------------------
  const handleEndSession = useCallback(async () => {
    if (!studentId || busy) return;
    timer.stop();

    // Disconnect voice if active
    if (voice.isVoiceModeActive) {
      voice.stopVoiceMode();
    }

    try {
      const data = await apiFetch<any>(`/api/end-session/${studentId}`, {
        method: "POST",
      });
      if (data.status === "ended") {
        setEndData(data);
        setEndSessionVisible(true);
      }
    } catch {
      // End session failed silently
    }
  }, [studentId, busy, timer, voice]);

  // Auto-detect session end from stream events (should_end_session)
  useEffect(() => {
    if (endSessionData && !endSessionVisible) {
      if (endSessionData.should_end) {
        // Auto-end triggered by the server
        setTimeout(async () => {
          timer.stop();
          if (voice.isVoiceModeActive) voice.stopVoiceMode();
          try {
            const data = await apiFetch<any>(`/api/end-session/${studentId}`, {
              method: "POST",
            });
            if (data.status === "ended") {
              setEndData(data);
              setEndSessionVisible(true);
            }
          } catch {
            // best effort
          }
        }, 1500);
      } else {
        timer.stop();
        setEndData(endSessionData);
        setEndSessionVisible(true);
      }
    }
  }, [endSessionData, endSessionVisible, timer, studentId]);

  // ----------------------------------------------------------------
  // Close End Session panel
  // ----------------------------------------------------------------
  const handleEndSessionClose = useCallback(
    async (sentiment: string | null, comment: string) => {
      // Submit session-level feedback if provided
      if (sentiment && endData?.session_db_id) {
        try {
          await fetch("/api/learning-session-feedback", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              session_db_id: endData.session_db_id,
              sentiment,
              comment,
            }),
          });
        } catch {
          // best effort
        }
      }

      setEndSessionVisible(false);
      setEndData(null);
      resetChatState();
      setViewMode("start");
      timer.reset();
      checkSessionStatus(currentSubject);
    },
    [endData, resetChatState, timer, currentSubject, checkSessionStatus]
  );

  // ----------------------------------------------------------------
  // Back to start (abandon session)
  // ----------------------------------------------------------------
  const backToStart = useCallback(() => {
    timer.stop();
    resetChatState();
    setEndSessionVisible(false);
    setEndData(null);
    setViewMode("start");
    timer.reset();
  }, [timer, resetChatState]);

  // ----------------------------------------------------------------
  // Per-message feedback (quick thumbs)
  // ----------------------------------------------------------------
  const handleFeedback = useCallback(
    (msgIndex: number, sentiment: string) => {
      // Find the assistant message content for preview
      let assistantCount = 0;
      let preview = "(message)";
      for (const msg of messages) {
        if (msg.role === "assistant" && msg.showFeedback !== false) {
          if (assistantCount === msgIndex) {
            preview = msg.content;
            break;
          }
          assistantCount++;
        }
      }

      setFeedbackMsgIndex(msgIndex);
      setFeedbackMsgPreview(preview);
      setFeedbackInitialSentiment(sentiment);
      setFeedbackModalOpen(true);
    },
    [messages]
  );

  // ----------------------------------------------------------------
  // Feedback modal submit
  // ----------------------------------------------------------------
  const handleFeedbackSubmit = useCallback(
    async (sentiment: string, comment: string, images: string[]): Promise<boolean> => {
      let fullComment = comment;
      if (images.length) {
        fullComment += "\n\n[ATTACHMENTS]\n" + images.join("\n");
      }

      try {
        const resp = await fetch("/api/feedback", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message_index: feedbackMsgIndex,
            sentiment,
            comment: fullComment,
          }),
        });
        if (resp.ok) {
          setFeedbackSentMap((prev) => ({ ...prev, [feedbackMsgIndex]: true }));
          return true;
        }
        return false;
      } catch {
        return false;
      }
    },
    [feedbackMsgIndex]
  );

  // ----------------------------------------------------------------
  // Student switch
  // ----------------------------------------------------------------
  const { switchStudent, createStudent } = useAuth();
  const handleSwitchStudent = useCallback(
    async (id: string) => {
      try {
        await switchStudent(id);
      } catch {
        // ignore
      }
    },
    [switchStudent]
  );
  const handleCreateStudent = useCallback(
    async (name: string) => {
      await createStudent(name);
    },
    [createStudent]
  );

  // ----------------------------------------------------------------
  // Reset student progress
  // ----------------------------------------------------------------
  const handleReset = useCallback(() => {
    if (!studentId) return;
    setResetConfirmOpen(true);
  }, [studentId]);

  const handleResetConfirm = useCallback(async () => {
    setResetConfirmOpen(false);
    if (!studentId) return;
    try {
      await fetch(
        `/api/reset/${studentId}?subject=${encodeURIComponent(currentSubject)}`,
        { method: "POST", credentials: "include" }
      );
      resetChatState();
      timer.reset();
      setViewMode("start");
      setShowContinue(false);
      showToast("Progress reset successfully", "success");
    } catch {
      showToast("Reset failed", "error");
    }
  }, [studentId, currentSubject, resetChatState, timer, showToast]);

  // ----------------------------------------------------------------
  // Exec step click -> show details modal
  // ----------------------------------------------------------------
  const handleExecStepClick = useCallback((entry: any) => {
    setExecDetailsEntry(entry);
    setExecDetailsOpen(true);
  }, []);

  // ----------------------------------------------------------------
  // Show student details
  // ----------------------------------------------------------------
  const handleShowStudentDetails = useCallback(() => {
    setStudentDetailsOpen(true);
  }, []);

  // ----------------------------------------------------------------
  // Show curriculum
  // ----------------------------------------------------------------
  const handleShowCurriculum = useCallback(() => {
    setCurriculumOpen(true);
  }, []);

  // ----------------------------------------------------------------
  // Render
  // ----------------------------------------------------------------

  // Auth loading or not logged in
  if (authLoading) {
    return null;
  }

  if (!user) {
    return (
      <>
        <SvgSprite />
        <LoginOverlay />
      </>
    );
  }

  // Start screen view
  if (viewMode === "start") {
    return (
      <div className="page-chat">
        <SvgSprite />
        <NavSidebar onNavTo={handleNavTo} />
        <div className={`container${iframeMode ? " iframe-mode" : ""}`}>
          <div className="chat-panel">
            <StartScreen
              currentSubject={currentSubject}
              onSelectSubject={handleSelectSubject}
              onStartNew={handleStartNew}
              onContinue={handleContinue}
              onShowStudentDetails={handleShowStudentDetails}
              onReset={handleReset}
              showContinue={showContinue}
              hasProgress={hasProgress}
              students={students}
              studentId={studentId}
              onSwitchStudent={handleSwitchStudent}
              onCreateStudent={handleCreateStudent}
              tutors={tutors}
              selectedTutorId={selectedTutorId}
              onSelectTutor={setSelectedTutorId}
              subjects={subjectList}
            />
          </div>
          <iframe
            ref={iframeRef}
            className="embed-frame"
            id="embedFrame"
            sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
          />
        </div>
        <div className="toast-container" id="toastContainer">
          {toasts.map((t) => (
            <div key={t.id} className={`toast ${t.type}`}>
              {t.message}
            </div>
          ))}
        </div>
        <StudentDetailsModal
          open={studentDetailsOpen}
          onClose={() => setStudentDetailsOpen(false)}
          studentId={studentId}
          subject={currentSubject}
        />

        {resetConfirmOpen && (
          <div className="reset-modal-overlay visible" onClick={(e) => { if (e.target === e.currentTarget) setResetConfirmOpen(false); }}>
            <div className="reset-modal">
              <h3>Reset Progress</h3>
              <p>Reset all {currentSubject} progress? This cannot be undone.</p>
              <div className="reset-modal-actions">
                <button className="reset-modal-cancel" onClick={() => setResetConfirmOpen(false)}>Cancel</button>
                <button className="reset-modal-confirm" onClick={handleResetConfirm}>Reset</button>
              </div>
            </div>
          </div>
        )}

        {newSessionConfirmOpen && (
          <div className="reset-modal-overlay visible" onClick={(e) => { if (e.target === e.currentTarget) { setNewSessionConfirmOpen(false); setPendingSimValues(null); } }}>
            <div className="reset-modal">
              <h3>Start New Session</h3>
              <p>This student has existing progress data for {currentSubject}. Starting a new session will <strong>reset all progress</strong> (fact mastery, interactions, completed capsules).</p>
              <p style={{ fontSize: 13, color: "#94a3b8", marginTop: 4 }}>Previous session recordings will be preserved.</p>
              <div className="reset-modal-actions">
                <button className="reset-modal-cancel" onClick={() => { setNewSessionConfirmOpen(false); setPendingSimValues(null); }}>Cancel</button>
                <button className="reset-modal-confirm" onClick={handleNewSessionConfirm}>Start Anyway</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Chat view (active session or ended)
  return (
    <div className="page-chat">
      <SvgSprite />
      <NavSidebar onNavTo={handleNavTo} />
      <div className={`container${iframeMode ? " iframe-mode" : ""}`}>
        <div className="chat-panel">
          {endSessionVisible ? (
            <EndSessionPanel
              visible={endSessionVisible}
              data={endData}
              onClose={handleEndSessionClose}
            />
          ) : (
            <>
              <ChatPanel
                messages={messages}
                tutorName={tutorName}
                isThinking={streaming && !!thinkingLabel}
                thinkingText={thinkingLabel || undefined}
                suggestions={suggestions}
                onSuggestionSelect={handleSuggestionSelect}
                onFeedback={handleFeedback}
                feedbackSentMap={feedbackSentMap}
                isLoading={busy}
                isVoiceMode={voice.isVoiceModeActive}
              />
              <ChatInput
                onSend={handleSend}
                disabled={busy}
                voice={voice}
                onVoiceStart={handleVoiceStart}
                onVoiceStop={handleVoiceStop}
              />
            </>
          )}
        </div>

        {!endSessionVisible && (
          <ExecPanel
            execLog={execLog.map((e) => ({
              step: e.step,
              details:
                typeof e.details === "string"
                  ? e.details
                  : JSON.stringify(e.details, null, 2),
              agent: e.agent,
              timestamp: e.timestamp,
            }))}
            factsState={factsState}
            totalFacts={totalFacts}
            tokenCount={tokenCount}
            questionsAsked={questionsAsked}
            correctAnswers={correctAnswers}
            timerRunning={timer.running}
            sessionActive={viewMode === "chat" && !endSessionVisible}
            onEndSession={handleEndSession}
            onShowDetails={handleShowStudentDetails}
            onExecStepClick={handleExecStepClick}
            isLoading={busy}
          />
        )}

        {!endSessionVisible && (
          <VocabBankPanel terms={vocabBank} definitionsHidden={definitionsHidden} />
        )}

        <iframe
          ref={iframeRef}
          className="embed-frame"
          id="embedFrame"
          sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
        />
      </div>

      <div className="toast-container" id="toastContainer">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.type}`}>
            {t.message}
          </div>
        ))}
      </div>

      <FeedbackModal
        open={feedbackModalOpen}
        messagePreview={feedbackMsgPreview}
        initialSentiment={feedbackInitialSentiment}
        onClose={() => setFeedbackModalOpen(false)}
        onSubmit={handleFeedbackSubmit}
      />

      <ExecDetailsModal
        open={execDetailsOpen}
        onClose={() => setExecDetailsOpen(false)}
        entry={execDetailsEntry}
      />

      <StudentDetailsModal
        open={studentDetailsOpen}
        onClose={() => setStudentDetailsOpen(false)}
        studentId={studentId}
        subject={currentSubject}
      />

      <CurriculumModal
        open={curriculumOpen}
        onClose={() => setCurriculumOpen(false)}
        phase={currentPhase}
        subject={currentSubject}
      />

      {resetConfirmOpen && (
        <div className="reset-modal-overlay visible" onClick={(e) => { if (e.target === e.currentTarget) setResetConfirmOpen(false); }}>
          <div className="reset-modal">
            <h3>Reset Progress</h3>
            <p>Reset all {currentSubject} progress? This cannot be undone.</p>
            <div className="reset-modal-actions">
              <button className="reset-modal-cancel" onClick={() => setResetConfirmOpen(false)}>Cancel</button>
              <button className="reset-modal-confirm" onClick={handleResetConfirm}>Reset</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
