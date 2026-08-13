-- Quests demo restoration — isolated schema.
--
-- ISOLATION CONTRACT: every table for the Quests platform lives in the
-- dedicated `quest_projects` schema, NOT `public`. There are deliberately NO
-- cross-schema foreign keys into public (students, quests, subjects, themes):
-- student_id / quest_id / subject_id / theme_id are stored as bare columns.
-- This guarantees Quests adds zero constraints onto the Tutors
-- learning system. Dropping this entire schema (DROP SCHEMA quest_projects CASCADE)
-- leaves the tutor tables in `public` byte-for-byte unaffected.
--
-- The `quests` and `quest_prompts` tables predate this migration and remain in
-- `public` (they are already Quests-only and referenced by /api/quests).

CREATE SCHEMA IF NOT EXISTS quest_projects;

-- ---------------------------------------------------------------------------
-- Projects — student workspaces for the "My Projects" area.
-- (Defined first: chat_sessions and project_files reference it.)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS quest_projects.projects (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id  TEXT NOT NULL,                   -- public.students.student_id (no FK — isolation)
    name        TEXT NOT NULL,
    description TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Chat sessions — backs the quest chat, the project "Chat with Documents"
-- flow, and persisted voice exchanges. quest_id / project_id are mutually
-- optional (a session belongs to a quest OR a project OR neither).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS quest_projects.chat_sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id      TEXT NOT NULL,              -- public.students.student_id (no FK — isolation)
    quest_id        UUID,                       -- public.quests.id (no FK — isolation)
    project_id      UUID REFERENCES quest_projects.projects(id) ON DELETE CASCADE,
    subject_id      TEXT,
    theme_id        TEXT,
    thread_id       TEXT,                        -- opaque conversation thread token (document chat)
    session_preview TEXT,                        -- short summary shown in the history sidebar
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at        TIMESTAMPTZ,
    duration_minutes INTEGER,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Chat messages — turns within a session (text chat and voice exchanges).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS quest_projects.chat_messages (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id   UUID NOT NULL REFERENCES quest_projects.chat_sessions(id) ON DELETE CASCADE,
    role         TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content      TEXT NOT NULL DEFAULT '',
    message_type TEXT,
    media_url    TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Project files — uploaded documents. For the demo, document context is
-- carried by `extracted_text` (injected into the chat prompt) rather than a
-- vector store; `is_embedded` marks that extraction succeeded so the UI shows
-- the "Embedded" badge.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS quest_projects.project_files (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id        UUID NOT NULL REFERENCES quest_projects.projects(id) ON DELETE CASCADE,
    name              TEXT NOT NULL,
    description       TEXT,
    original_filename TEXT,
    file_path         TEXT,
    file_size         BIGINT,
    mime_type         TEXT,
    is_embedded       BOOLEAN NOT NULL DEFAULT FALSE,
    embedding_error   TEXT,
    extracted_text    TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for the common lookups (by student, by quest/project, by session).
CREATE INDEX IF NOT EXISTS idx_eq_chat_sessions_student  ON quest_projects.chat_sessions (student_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_eq_chat_sessions_quest    ON quest_projects.chat_sessions (student_id, quest_id);
CREATE INDEX IF NOT EXISTS idx_eq_chat_sessions_project  ON quest_projects.chat_sessions (student_id, project_id);
CREATE INDEX IF NOT EXISTS idx_eq_chat_messages_session  ON quest_projects.chat_messages (session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_eq_projects_student       ON quest_projects.projects (student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_eq_project_files_project  ON quest_projects.project_files (project_id, created_at DESC);
