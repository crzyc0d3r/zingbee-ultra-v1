# Tutors

A student-facing, AI-powered adaptive tutoring platform. Tutors takes a learner through a curriculum of subjects → phases → themes → capsules → facts, guided by a subject-specific tutor persona that teaches, checks, and remediates in a one-on-one chat interface with voice, images, and persistent progress tracking.

Tutors is one of two products inside the Academy Next.js app (the other is **Quests**, a separate project-based learning experience). It ships as part of the ZingBee Ultra monorepo and runs on port **3001** in local development (or `academy.localhost` via Caddy).

---

## Table of Contents

- [Product Overview](#product-overview)
- [Authentication & Entry](#authentication--entry)
- [Maintenance Mode](#maintenance-mode)
- [Internationalization](#internationalization)
- [Primary Learning Flow](#primary-learning-flow)
  - [Dashboard](#dashboard)
  - [Subjects](#subjects)
  - [Phases (Age Level)](#phases-age-level)
  - [Themes](#themes)
  - [Subject Room](#subject-room)
  - [Start Session](#start-session)
  - [Learning Session (the Tutor Chat)](#learning-session-the-tutor-chat)
  - [Session Summary](#session-summary)
- [Supporting Features](#supporting-features)
  - [Placement Assessment](#placement-assessment)
  - [Practice](#practice)
  - [Achievements](#achievements)
  - [Community](#community)
  - [Study Session (Group Chat — Beta)](#study-session-group-chat--beta)
- [Voice & Accessibility Features](#voice--accessibility-features)
  - [Auto Read-Aloud (xAI TTS)](#auto-read-aloud-xai-tts)
  - [Dictation (Speech-to-Input)](#dictation-speech-to-input)
  - [Copy Button](#copy-button)
- [Feedback System](#feedback-system)
- [Header & Student Preferences](#header--student-preferences)
- [State That Follows the Student](#state-that-follows-the-student)
- [Tutors and Their Voices](#tutors-and-their-voices)
- [Data Model Summary (Student's Perspective)](#data-model-summary-students-perspective)

---

## Product Overview

Tutors is designed around a structured pedagogical loop, not free-form chat. Every tutoring session targets a single **capsule** (a small learning unit of ~10–15 facts) and walks the student through six phases managed server-side by the **Session Engine v6**:

```
RECALL → TEACH → TRY → CHECK → CHECK_REMEDIATION → EVIDENCE → CAPSULE_COMPLETE
```

The student sees a conversational chat interface with the assigned tutor (Aris, Newton, Mendi, Lexi, or Archi). Behind the scenes the engine batches facts (max 5 per batch), decides when to reteach vs. advance, tracks mastery, tiered-remediates on failure, and assigns final statuses of `MASTERED`, `PARTIAL_MASTERY`, or `FORFEITED` to every fact at the end.

The student never sees the state-machine terminology directly. They experience it as: the tutor explains something, asks them to try it, quizzes them, revisits the tricky ones, and wraps up with a summary.

---

## Authentication & Entry

### `/login`

A single card with two login paths:

- **Email + password** — POSTs to `/api/academy/student-login` with an organization slug (defaults to `academy`, overridable via `NEXT_PUBLIC_ORGANIZATION_SLUG`). The backend verifies credentials with bcrypt and issues a 30-day httpOnly session cookie. The student's profile is cached in `localStorage` for UI rendering only — the cookie is the real session.
- **Google Sign-In** — rendered only when `NEXT_PUBLIC_GOOGLE_CLIENT_ID` is set. Uses Google Identity Services; the returned credential is exchanged at `/api/google-login`.

The login form is **disabled during scheduled maintenance** (see next section) and shows a red alert banner with a live countdown to when logins resume.

### `/select-dashboard`

A fork between Tutors and Quests. Currently the Quests card is CSS-hidden, so in practice this routes students straight into Tutors.

### `/sso`

Landing page for Single Sign-On flows. Accepts `credential` (and optional `redirect`, defaulting to `/tutors/dashboard`) as query parameters, exchanges the credential for a session cookie, then forwards.

### `/api/auth/logout`

Clears the session cookie and all student-scoped `localStorage` keys (`user`, `student`, `organization`, `stats`, `selectedTutor`, `selectedTheme`, `selectedSubject`, `selectedPhase`, `preferredLanguage`, `currentPhase`, `completedPhases`, `continueSession`).

---

## Maintenance Mode

Tutors has a **scheduled maintenance window** system backed by the `scheduled_maintenance` database table. Each row is a daily recurring window stored as `timetz` (time-of-day with fixed UTC offset), so the same row means "this time every day" regardless of DST. A public endpoint `GET /api/maintenance-status` returns `{in_maintenance, next_start_utc, next_end_utc}`.

### What happens during a maintenance window

1. **A FastAPI middleware** intercepts every request. All `/api/*` calls except `/api/maintenance-status` and `/api/logout` return `503` with the maintenance payload.
2. **The in-memory tutoring session dict is cleared** on the first request that hits during the window — every active session ends on the server.
3. **The dashboard header polls `/api/maintenance-status`** every 30 seconds and displays a red banner with a live countdown to the next window (rendered in the student's browser local time, computed from UTC so every user sees a consistent boundary).
4. **The header also checks every second** whether the countdown has crossed zero. The instant it does, it calls `window.location.reload()`, which forces the onEnterMaintenance callback → logout → redirect to `/login`.
5. **The login page** shows a red destructive alert banner during the window, disables the form, and blocks the submit handler even if the button is bypassed. The banner renders the end time in the student's local timezone with a live countdown.

Students already mid-session at the moment maintenance starts are automatically logged out and sent to the login page.

### Adding a window

```sql
INSERT INTO scheduled_maintenance (id, start_date, end_date)
VALUES (1, '22:00:00-06:00'::timetz, '23:00:00-06:00'::timetz);
```

The module at `api/maintenance.py` resolves every row to the next concrete UTC timestamp, handles midnight-crossing windows, and supports multiple rows (the earliest upcoming window wins, with an active window taking priority over any future one).

---

## Internationalization

Tutors supports **11 locales** with full RTL handling for Arabic and Urdu:

| Locale | Language  |
|--------|-----------|
| `en`   | English   |
| `es`   | Spanish   |
| `zh`   | Chinese   |
| `hi`   | Hindi     |
| `ar`   | Arabic (RTL) |
| `fr`   | French    |
| `pt`   | Portuguese |
| `bn`   | Bengali   |
| `ru`   | Russian   |
| `de`   | German    |
| `ur`   | Urdu (RTL) |

Locale selection flows through a modal in the header. The selection is persisted to a cookie (for SSR) and to `localStorage.preferredLanguage` (for client code). Message bundles live under `messages/{locale}/{common,topics,projects}.json`. The page does a full reload on locale change so SSR-rendered strings and direction attributes update.

---

## Primary Learning Flow

### Dashboard

Path: `/tutors/dashboard`

The entry point after login. A compact landing page featuring the `TutorGrid` component, which lets the student pick a tutor to start with. From here the student typically branches into `Subjects`, `Practice`, `Achievements`, or continues an in-progress session.

### Subjects

Path: `/tutors/subjects`

Grid of the five subjects (Biology, Chemistry, English, Math, Physics). **Tutors do not belong to subjects** — any tutor can teach any subject/theme. The default tutor stored on each `curriculum_themes` row is a starting suggestion, but the student picks whichever tutor they want on the start-session page, and that choice is sent to the backend as a `tutor_id` override when the greeting fires.

| Subject    | Phases | Age Range |
|------------|--------|-----------|
| Biology    | 1–4    | 10–18     |
| Chemistry  | 1–5    | 8–18      |
| English    | 1–4    | 10–18     |
| Math       | 1–4    | 10–18     |
| Physics    | 1–5    | 8–18      |

Clicking a subject stores the selection in `localStorage.selectedSubject` and routes to Phases.

### Phases (Age Level)

Path: `/tutors/phases`

Lets the student pick the phase/age level for the chosen subject. **If the student has prior placement data**, this page auto-skips to Themes. Otherwise it shows Phases 1–4 (or 1–5 for Chemistry and Physics) with age ranges. Selection persists to `localStorage.selectedPhase`.

### Themes

Path: `/tutors/themes`

A browsable list of themes within the current subject+phase. Each theme card shows:
- **Title and description**
- **Guiding question** — the conceptual question the theme is organized around
- **Progress bar** — capsule completion within the theme
- **Tutor avatar** — reminder of who will teach the theme

Clicking a theme stores it in `localStorage.selectedTheme` and routes to Subject Room.

### Subject Room

Path: `/tutors/subject-room`

Welcome/orientation page for a theme. Shows:
- A hero banner: *"Welcome to {theme title}"*
- **"Continue Where You Left Off"** button if a prior session exists (`localStorage.continueSession`)
- **"Start Fresh"** button
- An overview of the 6-step learning journey (Recall → Teach → Try → Check → Evidence → Next Steps) so the student knows what to expect

Exits to Start Session.

### Start Session

Path: `/tutors/start-session`

The final "before you dive in" screen. Shows:

- **Tutor picker** — all tutors (fetched from `/api/tutors`) with persona description, traits, and a voice label. Pre-selected to the subject's tutor. Clicking a tutor stores `{id, name, description, specialty, voice}` into `localStorage.selectedTutor`.
- **Capsule roadmap** — every capsule in the current theme with progress indicators: `not_started`, `next`, `completed`, or `mastered`. Also shows a percentage completion, a count of completed-vs-total capsules, and highlights the recommended next capsule.
- **Start Learning Session** button — routes to `/tutors/learning`, where the session engine begins the conversation.

### Learning Session (the Tutor Chat)

Path: `/tutors/learning`

The core of the product. A split layout:

#### Left sidebar — `CapsuleSidebar`

- Subject name and phase
- Current theme name
- Current capsule name
- **Current step pill** (RECALL / TEACH / TRY / CHECK / EVIDENCE / CAPSULE_COMPLETE)
- **Fact progress bar** with four color-coded segments:
  - Mastered (green)
  - Assessed (teal)
  - Taught (blue)
  - Pending (grey)
- **Fact list** — every fact in the capsule, color-dotted by its current status (mastered, assessed, taught, pending)
- A **Stop Session** button that lets the student end early and skip to Session Summary

#### Main chat area

- Streaming tutor messages, rendered with markdown, LaTeX (KaTeX), code highlighting, and Mermaid diagrams
- **Image generation** — the engine generates illustrations inline via xAI Grok Imagine; while waiting, a shimmer placeholder reads "Generating illustration..." and the image slots into the conversation when ready
- **Message feedback row** per assistant message (see [Feedback System](#feedback-system))
- A scroll anchor that keeps the latest message in view

#### Input area

- A text field for the student's typed reply
- A **send button** (disabled while the LLM is streaming or generating an image)
- A **dictation mic button** (see [Dictation](#dictation-speech-to-input))
- Live **voice mode** was removed for now — the mic is strictly dictation, not two-way realtime voice

When the student sends a message, it streams back through a Server-Sent Events pipeline. The client shows a "thinking" indicator, then tokens flow in real time, then an image placeholder (if one is coming), then the final image.

### Session Summary

Path: `/tutors/session-summary`

Post-session recap showing:
- Duration, questions asked, accuracy %, facts mastered
- A final **progress bar** breakdown (taught / assessed / mastered / remaining)
- **Per-fact breakdown cards** — which facts ended `MASTERED`, `PARTIAL_MASTERY`, or `FORFEITED`
- **Continue Learning** button that routes back to `start-session` to pick the next capsule

The student's `report_card` JSONB column in `students` is updated as the session progresses, so this screen reads from the authoritative server state — it's not just client memory.

---

## Supporting Features

### Placement Assessment

Path: `/tutors/assessment`

A resumable, interview-style placement assessment used to auto-place a new student into the right phase for a subject. Flow:

1. **Intro screen** — explains what the assessment is and how long it takes
2. **Multi-question Q&A** — one question at a time, with a progress bar
3. **Generates a phase placement** on completion, which then short-circuits the Phases page in future sessions

The assessment state is persisted server-side in `student_assessments` (JSONB), so a student can leave and resume without losing progress. Scoring and placement logic run on the backend.

### Practice

Path: `/tutors/practice`

Two-column layout:
- **Left: LessonSelector** — pick a lesson to drill
- **Right: PracticeInterface** — the drill itself

Used for targeted practice outside of the structured capsule flow.

### Achievements

Path: `/tutors/achievements`

- **Achievement grid** — badges earned across subjects and milestones
- **Level progress bar** — current XP/level
- **Rewards celebration** component that animates when new achievements unlock

### Community

Path: `/tutors/community`

A "Learn with Others" page that lists other students via the `StudentList` component. In the current build this uses stubbed data; the UX scaffolding is in place for future peer-learning features.

### Study Session (Group Chat — Beta)

Path: `/tutors/study-session`

A group study chat interface with a tutor plus multiple students, a participants sidebar, and threaded messages. Currently powered by mock data — it's a preview of a future multi-participant mode.

---

## Voice & Accessibility Features

### Auto Read-Aloud (xAI TTS)

The tutor's responses can be spoken out loud using **xAI TTS** with the tutor's voice.

- **Toggle** — the volume icon in the feedback row below any assistant message turns auto-read on or off globally. State is persisted to `localStorage.tutors.autoReadTts`.
- **Default: ON** — new students get the tutor's greeting spoken to them automatically on first visit.
- **Voice selection** — reads from `selectedTutor.voice` in localStorage (set when the student picks the tutor on `start-session`), which comes from the tutor's `persona.voice` JSONB field in the database. Currently:

  | Tutor  | Subject    | Voice |
  |--------|------------|-------|
  | Aris   | Biology    | Ara   |
  | Newton | Physics    | Sal   |
  | Mendi  | Chemistry  | Eve   |
  | Lexi   | English    | Leo   |
  | Archi  | Math       | Rex   |

  If the student's stored tutor doesn't have a voice yet (older sessions), the client falls back to a subject-based map with the same values.

- **Timing** — the audio only fires after the text has **fully finished streaming** (detected by watching the `chat.streaming` flag for a `true→false` transition). Partial tokens are never spoken.
- **Independence from image gen** — the TTS fetch hits the backend directly (bypassing the Next.js dev proxy) so the playback isn't queued behind the still-open SSE stream that's waiting on image generation.
- **Playback control** — clicking the volume icon again stops any currently-playing audio.

Under the hood: the client POSTs to `/api/voice/tts` with `{text, voice_id, language}`; the backend proxies to the xAI TTS API and streams MP3 audio back. The client plays it through an `<audio>` element backed by a blob URL.

### Dictation (Speech-to-Input)

The mic icon next to the send button starts **browser-native speech recognition** (`webkitSpeechRecognition`) that populates the input box with the transcript in real time.

- **Continuous mode** — the mic stays open through pauses up to an **8-second silence timeout** (reset every time a new phrase is recognized).
- **Auto-disables on send** — pressing the send button immediately stops any active recognition and greys out the mic.
- **Auto-disables while the LLM is thinking** — `disabled={busy}` on the mic button.
- **Not continuous voice** — this is pure STT-to-input. The student can edit the transcript before sending. There is no two-way live voice conversation mode.

### Copy Button

Each assistant message has a **copy icon** in the feedback row that copies the markdown-stripped text to the clipboard. On success, the icon turns green for 1.5 seconds and the tooltip flips to "Copied!".

---

## Feedback System

Every assistant message (once it's finished streaming) shows a feedback row with four icons:

1. **Volume toggle** (TTS auto-read on/off — see above)
2. **Copy**
3. **Thumbs up**
4. **Thumbs down**
5. **Comment** (opens an inline text input)

All four feedback icons:
- Are disabled while the LLM is thinking (greyed out with a "Wait for the tutor to finish" tooltip)
- Capture a **screenshot of the full page** via `html2canvas` at scale 0.5, JPEG quality 0.6 (~100–300KB) on submit
- Attach the screenshot as a base64 data URL inside the `comment` field using the `\n\n[ATTACHMENTS]\n<data:image/jpeg;base64,...>` marker format that the **Red Team Studio** feedback viewer parses and renders inline

The feedback row is recorded in the `learning_session_feedback` table with the full assistant message text, surrounding conversation context, execution snapshot, and session stats. This is what the Red Team Studio's **Session Feedback** tab reads to show reviewers a complete picture of every thumb-down.

### Submission details

- Submissions POST to `/api/feedback` with `{sentiment, comment, message_index}`.
- The backend requires an active in-memory session, validates the sentiment (`positive`, `negative`, `idea`, or `question`), and persists the row including per-message context and a live snapshot of the execution log.
- Failures fall through silently — feedback is non-critical and never blocks the conversation.

---

## Header & Student Preferences

The `DashboardHeader` sits on every authenticated page. It contains:

- **Back button** (contextual — back map defined per route)
- **Tutors logo** and a greeting ("Good afternoon, {name}" based on local time and the current student's first name)
- **Switch Platform** button → `/select-dashboard`
- **Avatar + username dropdown** with:
  - **Preferences** → opens `StudentPreferencesModal` (language, accessibility, account options)
  - **Logout** → clears cookie + all student localStorage keys, routes to `/login`
- **Maintenance banner** (red, below the avatar) — hidden when no window is scheduled; shows `"This pilot is offline for scheduled maintenance from {start local} to {end local}"` plus a live countdown to `"Next maintenance session is in: Xh YYm ZZs"`
- **`busy` prop** — when true (passed from pages that want to lock the header, e.g. during an active tutoring turn), the Back, Switch Platform, and Language buttons are disabled

---

## State That Follows the Student

Most of the student's state lives on the server; `localStorage` is only a UI-rendering cache. Keys in use:

| Key                   | Source of Truth | Purpose |
|-----------------------|-----------------|---------|
| `user`                | Cookie (re-fetch) | Displayed name, level, credits |
| `student`             | DB              | Current student profile |
| `organization`        | DB              | Org slug and name for branding |
| `selectedSubject`     | UI only         | Current subject picker state |
| `selectedPhase`       | UI only         | Current phase picker state |
| `selectedTheme`       | UI only         | Current theme the student is working in |
| `selectedTutor`       | UI only         | `{id, name, description, specialty, voice}` |
| `sessionStartTime`    | UI only         | Client-side session stopwatch |
| `preferredLanguage`   | UI + cookie     | Current i18n locale |
| `continueSession`     | UI only         | Flag for "Continue Where You Left Off" |
| `tutors.autoReadTts` | UI only      | Auto-read TTS on/off flag |

The real session (auth) lives entirely in an httpOnly cookie. The active tutoring session lives in an in-memory dict on the API server plus a persistent row in `learning_sessions`. Everything in the student's `report_card` JSONB column is the authoritative state for progress.

---

## Tutors and Their Voices

The five tutors, each with a personality and an assigned xAI voice:

| Tutor  | Subject    | Voice | Personality (excerpt) |
|--------|------------|-------|-----------------------|
| **Aris**   | Biology    | Ara   | Warm and enthusiastic; uses vivid real-world analogies matched to the topic (nature/animals for biology, cooking for chemistry, sports for physics, weather for earth science). |
| **Newton** | Physics    | Sal   | Energetic and curious; connects physics to sports, playground activities, and everyday motion. Uses thought experiments and what-if scenarios. |
| **Mendi**  | Chemistry  | Eve   | Patient and methodical; explains chemistry through cooking, cleaning, and kitchen science. Builds step by step, never rushing past confusion. |
| **Lexi**   | English    | Leo   | Expressive and witty; dramatic flair, humor and wordplay, encourages students to find their own voice. |
| **Archi**  | Math       | Rex   | Playful and curious; games, puzzles, real-world challenges. Celebrates creative problem-solving, not just correct answers. |

Each tutor's full persona lives in the `tutors.persona` JSONB column as `{tutor_name, creator_name, persona_traits[], persona_description, voice}`. The backend `SUBJECT_VOICES` map in `api/livekit/voice_routes.py` mirrors these assignments for the voice agent.

---

## Data Model Summary (Student's Perspective)

A student's experience in Tutors touches these tables:

- **`users`** — login record
- **`students`** — profile and the authoritative `report_card` JSONB that tracks every fact's mastery status per capsule, theme, phase, and subject
- **`student_assessments`** — placement assessment state (resumable)
- **`learning_sessions`** — one row per tutoring session (start time, end time, duration, questions, accuracy, tokens, execution log, system log)
- **`learning_session_messages`** — full chat transcript
- **`learning_session_feedback`** — per-message thumbs/comments with context and screenshots
- **`scheduled_maintenance`** — daily recurring maintenance windows
- **`tutors`** — persona + voice
- **`curriculum_themes` / `curriculum_capsules` / `curriculum_facts` / `curriculum_fact_distillations` / `curriculum_fact_images`** — the content the student is learning
- **`placement_questions`** — the bank that feeds the placement assessment
- **`subjects` / `subject_curriculum`** — subject and phase definitions

For the full schema, see the root the root architecture doc and `db/zingbee-ultra-backup-*.sql`.
