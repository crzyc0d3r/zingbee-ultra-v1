import { Quest } from './types/quest'


export interface AssessmentDomain {
    id: string;
    name: string;
    description?: string;
    display_order?: number;
}

export interface Rubric {
    id: string;
    title: string;
    description?: string;
    theme_id?: string;
    exercise_id?: string;
    created_at: string;
}

export interface RubricCriterion {
    id: string;
    rubric_id: string;
    domain_id: string;
    criterion: string;
    description?: string;
    display_order?: number;
}

export interface PerformanceLevel {
    id: string;
    rubric_id: string;
    name: string;
    credit_value: number; // DECIMAL(3,2) from backend
    display_order?: number;
}

export interface CriterionDescriptor {
    id: string;
    criterion_id: string;
    level_id: string;
    descriptor: string;
}

export interface StudentDomainPerformance {
    id: string;
    student_id: string;
    theme_id?: string;
    exercise_id?: string;
    domain_id: string;
    performance_band: string;
    credit_value: number; // DECIMAL(3,2) from backend
    evaluated_at: string;
}

export interface PortfolioArtifact {
    id: string;
    student_id: string;
    theme_id?: string;
    exercise_id?: string;
    domain_id?: string;
    artifact_url?: string;
    artifact_type?: string;
    description?: string;
    created_at: string;
}

export interface StudentLevelsUpdate {
    phase_credits?: { [key: string]: number };
    award_flags?: { [key: string]: boolean };
}

// Placement Assessment Types
export interface PlacementQuestionWithVariant {
    id: string;
    question_code: string;
    display_order: number;
    question_type: string;
    theme_name: string;
    concept_capsule: string;
    difficulty: number;
    weight: number;
    max_time_seconds: number;
    variant_id: string;
    question_text: string;
    options: string[] | null;
}

export interface PlacementQuestionsListResponse {
    subject_id: string;
    subject_name: string;
    total_questions: number;
    max_score: number;
    questions: PlacementQuestionWithVariant[];
}

export interface AssessmentResponseData {
    question_id: string;
    question_code: string;
    question_number: number;
    variant_id: string;
    student_answer: string;
    started_at: string;
    answered_at: string;
    time_spent_seconds: number;
}

export interface AssessmentStartRequest {
    student_id: string;
    subject_id: string;
}

export interface AssessmentStartResponse {
    id: string;
    student_id: string;
    subject_id: string;
    status: string;
    started_at: string;
    assigned_variants: { [key: string]: string };
    questions: PlacementQuestionWithVariant[];
}

export interface AssessmentResumeResponse {
    id: string;
    student_id: string;
    subject_id: string;
    status: string;
    started_at: string;
    current_question_index: number;
    assigned_variants: { [key: string]: string };
    questions: PlacementQuestionWithVariant[];
    responses: AssessmentResponseData[];
}

export interface AssessmentSaveProgressRequest {
    current_question_index: number;
    responses: AssessmentResponseData[];
}

export interface AssessmentProgressResponse {
    id: string;
    status: string;
    current_question_index: number;
    responses_saved: number;
    started_at: string;
}

export interface StudentAssessmentSubmit {
    assessment_id: string;
    responses: AssessmentResponseData[];
}

export interface ThemeScore {
    correct: number;
    total: number;
    percentage: number;
}

export interface AssessmentResultResponse {
    id: string;
    student_id: string;
    subject_id: string;
    total_score: number;
    max_score: number;
    assigned_phase_id: string | null;
    assigned_phase_number: number;
    assigned_phase_name: string;
    total_time_seconds: number;
    phase_scores: { [key: string]: number };
    theme_scores: { [key: string]: ThemeScore };
    strengths: string[];
    areas_to_develop: string[];
    message: string;
    started_at: string;
    completed_at: string;
}

export interface StudentAssessmentSummary {
    id: string;
    subject_id: string;
    subject_name: string;
    status: string;
    started_at: string;
    completed_at: string | null;
    total_score: number | null;
    max_score: number | null;
    assigned_phase_number: number | null;
    assigned_phase_name: string | null;
}

export interface EvaluatedResponse {
    question_id: string;
    question_code: string;
    question_number: number;
    variant_id: string;
    theme_name?: string;
    phase_number?: number;
    question_type?: string;
    student_answer: string;
    correct_answer: string;
    is_correct: boolean;
    points_earned: number;
    time_spent_seconds: number;
    started_at: string;
    answered_at: string;
    evaluation_method?: string;
}

export interface StudentAssessmentDetail {
    id: string;
    student_id: string;
    subject_id: string;
    status: string;
    started_at: string;
    completed_at: string | null;
    total_score: number | null;
    max_score: number | null;
    assigned_phase_id: string | null;
    created_at: string;
    assessment_data: {
        assigned_variants?: { [key: string]: string };
        total_score?: number;
        max_score?: number;
        assigned_phase?: number;
        total_time_seconds?: number;
        phase_scores?: { [key: string]: number };
        theme_scores?: { [key: string]: ThemeScore };
        responses?: EvaluatedResponse[];
    };
}

export interface PlacementCheckResponse {
    has_placement: boolean;
    has_in_progress: boolean;
    in_progress_assessment_id: string | null;
    placement: {
        phase_id: string;
        phase_number: number;
        assessment_id: string;
        assessed_at: string;
        theme_placements?: { [key: string]: { phase: number; strength: number } };
    } | null;
}

export interface StudentPreferences {
    student_id: string;
    preferred_subject_id: string | null;
    notifications_enabled: boolean;
    theme: string;
    tutor_placement: { [key: string]: any } | null;
    created_at: string;
    updated_at: string;
}

export interface Project {
    id: string
    student_id: string
    name: string
    description?: string
    created_at: string
    updated_at: string
    file_count?: number
}

export interface ProjectFile {
    id: string
    project_id: string
    name: string
    description?: string
    original_filename: string
    file_path: string
    file_size?: number
    mime_type?: string
    is_embedded: boolean
    embedding_error?: string
    created_at: string
}

export interface Subject {
    id: string
    name: string
    specialty: string
    description: string
    personality: string
    character_emoji?: string
    color_code?: string
    avatar_url?: string
    is_active?: boolean
}

export interface Organization {
    id: string
    name: string
    slug: string
    description?: string
    is_active?: boolean
}

export interface Phase {
    id: string
    name: string
    age_range: string
    description?: string
    icon?: string  // SVG filename e.g. "/icons/glassmorphism/open-book.svg"
    display_order?: number
}

export interface LearningStep {
    id: string
    step_type: string
    display_name: string
    description?: string
    icon_emoji?: string
    color_code?: string
    display_order?: number
}

export interface Theme {
    id: string
    subject_id: string
    phase_id?: string
    title: string
    title_key: string  // Always English title for i18n key lookups
    description: string
    driving_question?: string
    icon?: string  // SVG filename e.g. "/icons/glassmorphism/book.svg"
    conceptual_goal?: string
    application_focus?: string
}

export interface Capsule {
    id: string
    theme_id: string
    title: string
    description?: string
    display_order: number
    credit_value: number
    created_at: string
    updated_at: string
}

export interface CapsuleWithProgress {
    id: string
    theme_id: string
    title: string
    description?: string
    display_order: number
    credit_value: number
    status: 'not_started' | 'in_progress' | 'completed' | 'mastered'
    current_step?: 'RECALL' | 'TEACH' | 'TRY' | 'EVIDENCE'
    check_score?: number
    credit_earned: number
}

export interface CapsuleFact {
    id: string
    order: number
    core_fact: string
    scaffold: string[]
    vocabulary: string
    micro_check: string
    difficulty_weight: number
    // Per-student progress flags — only populated when getFacts() is called
    // with a studentId. is_taught = TEACH->TRY done; is_mastered = passed the
    // final EVIDENCE check.
    is_taught?: boolean
    is_assessed?: boolean
    is_mastered?: boolean
}

export interface CapsuleQuestion {
    id: string
    capsule_id: string
    question_order: number
    question_text: string
    question_type: 'mcq' | 'true_false' | 'short_answer'
    options?: string[]
    difficulty: number
    credit_value: number
}

export interface StudentCapsule {
    id: string
    student_id: string
    capsule_id: string
    status: string
    started_at: string
    completed_at?: string
    details: {
        teach_completed?: boolean
        try_completed?: boolean
        check_score?: number
        questions_answered?: number
        questions_correct?: number
        weak_concepts?: string[]
        attempts?: number
        time_spent_minutes?: number
    }
    credit_earned: number
    created_at: string
    updated_at: string
}

export interface QuestionAnswer {
    question_id: string
    answer: string
}

export interface SubmitCheckResponse {
    student_capsule_id: string
    total_questions: number
    questions_correct: number
    score: number
    status: string
    credit_earned: number
    weak_concepts: string[]
    passed: boolean
    feedback: string
}

export interface LearningFlowInitResponse {
    has_history: boolean
    current_capsule_id?: string
    current_step: string
    recall_summary?: string
    capsules_completed: number
    total_capsules: number
}

export interface LearningFlowStatus {
    student_id: string
    theme_id: string
    current_capsule_id?: string
    current_capsule_title?: string
    current_step: string
    capsules_progress: Array<{
        id: string
        title: string
        display_order: number
        status: string
        current_step?: string
        credit_earned: number
        credit_value: number
    }>
    total_credit_earned: number
    total_credit_possible: number
}

export interface RecallResponse {
    has_history: boolean
    recall_summary?: string
    item_count: number
    last_session_date?: string
}

export interface Student {
    id: string
    username: string
    email: string
    first_name: string
    last_name: string
    age?: number
    date_of_birth?: string
    gender?: string  // 'male', 'female', 'other', 'prefer_not_to_say'
    avatar_url?: string
    bio?: string
}

export interface ChatSession {
    id: string
    student_id: string
    subject_id?: string
    theme_id?: string
    quest_id?: string
    project_id?: string
    started_at: string
    ended_at?: string
    duration_minutes?: number
    session_preview?: string
    is_active: boolean
}

export interface ChatMessage {
    id: string
    session_id: string
    role: 'user' | 'assistant' | 'system'
    content: string
    message_type?: string
    media_url?: string
    created_at: string
}

export interface StudentLoginResponse {
    student: Student
    organization: Organization
}

export interface AuthMeResponse {
    user: {
        id: string
        username: string
        first_name: string
        last_name: string
        email: string
    }
    student?: Student
    organization?: Organization
}

class ApiClient {
    private baseUrl: string

    constructor(baseUrl: string = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:9000/api') {
        this.baseUrl = baseUrl
    }

    private getLang(): string {
        if (typeof window !== 'undefined') {
            return localStorage.getItem('preferredLanguage') || 'en'
        }
        return 'en'
    }

    private appendLang(endpoint: string): string {
        const lang = this.getLang()
        const separator = endpoint.includes('?') ? '&' : '?'
        return `${endpoint}${separator}lang=${lang}`
    }

    private handleUnauthorized(): never {
        // Clear all auth-related localStorage
        if (typeof window !== 'undefined') {
            localStorage.removeItem('user')
            localStorage.removeItem('student')
            localStorage.removeItem('organization')
            localStorage.removeItem('selectedTutor')
            localStorage.removeItem('currentPhase')
            localStorage.removeItem('completedPhases')
            // Redirect to login
            window.location.href = '/login'
        }
        throw new Error('Unauthorized - session expired')
    }

    private checkResponse(response: Response): void {
        if (response.status === 401) {
            this.handleUnauthorized()
        }
        if (!response.ok) {
            throw new Error(`API Error: ${response.statusText}`)
        }
    }

    async get<T>(endpoint: string): Promise<T> {
        const response = await fetch(`${this.baseUrl}${endpoint}`, {
            credentials: 'include'
        })
        this.checkResponse(response)
        return response.json()
    }

    async post<T>(endpoint: string, data: any): Promise<T> {
        const response = await fetch(`${this.baseUrl}${endpoint}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            credentials: 'include',
            body: JSON.stringify(data),
        })
        this.checkResponse(response)
        return response.json()
    }

    async put<T>(endpoint: string, data: any): Promise<T> {
        const response = await fetch(`${this.baseUrl}${endpoint}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
            },
            credentials: 'include',
            body: JSON.stringify(data),
        })
        this.checkResponse(response)
        return response.json()
    }

    async delete<T>(endpoint: string): Promise<T> {
        const response = await fetch(`${this.baseUrl}${endpoint}`, {
            method: 'DELETE',
            credentials: 'include',
        })
        this.checkResponse(response)
        return response.json()
    }

    auth = {
        studentLogin: async (username: string, password: string, organizationSlug: string, turnstileToken?: string): Promise<StudentLoginResponse> => {
            // Login goes through Next.js proxy so the cookie is set on THIS origin
            const response = await fetch('/api/academy/student-login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ email: username, password, turnstile_token: turnstileToken }),
            })
            if (!response.ok) {
                const body = await response.json().catch(() => ({}))
                throw new Error(body.error || `Login failed (${response.status})`)
            }
            return response.json()
        },
        googleLogin: async (credential: string): Promise<StudentLoginResponse> => {
            const response = await fetch('/api/auth/google', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ credential }),
            })
            if (!response.ok) {
                const body = await response.json().catch(() => ({}))
                throw new Error(body.error || `Google login failed (${response.status})`)
            }
            return response.json()
        },
        logout: async (): Promise<{ message: string }> => {
            const response = await fetch('/api/auth/logout', {
                method: 'POST',
                credentials: 'include',
            })
            return response.json()
        },
        me: async (): Promise<AuthMeResponse> => {
            const response = await fetch('/api/auth/me', {
                credentials: 'include',
            })
            if (!response.ok) throw new Error('Not authenticated')
            return response.json()
        }
    }

    subjects = {
        list: async (activeOnly: boolean = false): Promise<Subject[]> => {
            return this.get<Subject[]>('/academy/subjects')
        },
        get: async (id: string): Promise<Subject> => {
            return this.get<Subject>(`/academy/subjects/${id}`)
        },
    }

    organizations = {
        list: async (): Promise<Organization[]> => {
            return this.get<Organization[]>('/organizations')
        },
        get: async (id: string): Promise<Organization> => {
            return this.get<Organization>(`/organizations/${id}`)
        },
        getBySlug: async (slug: string): Promise<Organization> => {
            return this.get<Organization>(`/organizations/slug/${slug}`)
        },
    }

    phases = {
        list: async (subjectId?: string): Promise<Phase[]> => {
            if (subjectId) return this.get<Phase[]>(`/academy/subjects/${subjectId}/phases`)
            return this.get<Phase[]>('/academy/subjects')
        },
        get: async (id: string): Promise<Phase> => {
            return this.get<Phase>(`/academy/subjects/${id}/phases`)
        },
    }

    learningSteps = {
        list: async (): Promise<LearningStep[]> => {
            return this.get<LearningStep[]>(this.appendLang('/phases/steps'))
        },
        get: async (stepType: string): Promise<LearningStep> => {
            return this.get<LearningStep>(this.appendLang(`/phases/steps/${stepType}`))
        },
    }

    themes = {
        list: async (subjectId?: string, phaseId?: string): Promise<Theme[]> => {
            const params = new URLSearchParams()
            if (subjectId) params.append('subject_id', subjectId)
            if (phaseId) params.append('phase', phaseId)
            return this.get<Theme[]>(`/academy/themes?${params.toString()}`)
        },
        get: async (id: string): Promise<Theme> => {
            return this.get<Theme>(`/academy/themes/${id}/capsules`)
        },
    }

    capsules = {
        list: async (themeId?: string): Promise<Capsule[]> => {
            if (themeId) return this.get<Capsule[]>(`/academy/themes/${themeId}/capsules`)
            return this.get<Capsule[]>('/academy/themes')
        },
        get: async (id: string): Promise<Capsule> => {
            return this.get<Capsule>(`/academy/themes/${id}/capsules`)
        },
        getWithProgress: async (studentId: string, themeId: string): Promise<CapsuleWithProgress[]> => {
            return this.get<CapsuleWithProgress[]>(`/academy/themes/${themeId}/capsules?student_id=${studentId}`)
        },
        getNext: async (studentId: string, themeId: string): Promise<CapsuleWithProgress | null> => {
            return this.get<CapsuleWithProgress | null>(`/academy/themes/${themeId}/capsules?student_id=${studentId}`)
        },
        getQuestions: async (capsuleId: string): Promise<CapsuleQuestion[]> => {
            // Quiz questions are handled by the session engine in zingbee-rt
            return [] as CapsuleQuestion[]
        },
        getFacts: async (capsuleId: string, studentId?: string): Promise<CapsuleFact[]> => {
            const qs = studentId ? `?student_id=${encodeURIComponent(studentId)}` : ""
            return this.get<CapsuleFact[]>(`/academy/capsules/${capsuleId}/facts${qs}`)
        },
    }

    studentCapsules = {
        list: async (studentId: string, themeId?: string): Promise<StudentCapsule[]> => {
            const params = new URLSearchParams()
            if (themeId) params.append('theme_id', themeId)
            return this.get<StudentCapsule[]>(`/student-capsules/${studentId}?${params.toString()}`)
        },
        get: async (studentId: string, capsuleId: string): Promise<StudentCapsule> => {
            return this.get<StudentCapsule>(`/student-capsules/${studentId}/${capsuleId}`)
        },
        start: async (studentId: string, capsuleId: string): Promise<StudentCapsule> => {
            return this.post<StudentCapsule>('/student-capsules/start', { student_id: studentId, capsule_id: capsuleId })
        },
        completeTeach: async (studentId: string, capsuleId: string): Promise<StudentCapsule> => {
            return this.post<StudentCapsule>('/student-capsules/complete-teach', { student_id: studentId, capsule_id: capsuleId })
        },
        completeTry: async (studentId: string, capsuleId: string): Promise<StudentCapsule> => {
            return this.post<StudentCapsule>('/student-capsules/complete-try', { student_id: studentId, capsule_id: capsuleId })
        },
        submitCheck: async (studentId: string, capsuleId: string, answers: QuestionAnswer[]): Promise<SubmitCheckResponse> => {
            return this.post<SubmitCheckResponse>('/student-capsules/submit-check', { student_id: studentId, capsule_id: capsuleId, answers })
        },
        complete: async (studentId: string, capsuleId: string): Promise<StudentCapsule> => {
            return this.post<StudentCapsule>('/student-capsules/complete', { student_id: studentId, capsule_id: capsuleId })
        },
    }

    learningFlow = {
        init: async (studentId: string, themeId: string): Promise<LearningFlowInitResponse> => {
            return this.post<LearningFlowInitResponse>('/learning-flow/init', { student_id: studentId, theme_id: themeId })
        },
        getRecall: async (studentId: string, themeId: string): Promise<RecallResponse> => {
            return this.get<RecallResponse>(this.appendLang(`/learning-flow/recall/${studentId}/${themeId}`))
        },
        getStatus: async (studentId: string, themeId: string): Promise<LearningFlowStatus> => {
            return this.get<LearningFlowStatus>(this.appendLang(`/learning-flow/status/${studentId}/${themeId}`))
        },
    }

    students = {
        list: async (organizationId: string): Promise<Student[]> => {
            return this.get<Student[]>('/academy/subjects')
        },
        get: async (id: string): Promise<Student> => {
            return this.get<Student>(`/academy/student/${id}/progress`)
        },
        create: async (data: Partial<Student>): Promise<Student> => {
            return this.post<Student>('/api/create-student', data)
        },
    }

    chatSessions = {
        list: async (studentId: string, questId?: string, projectId?: string, subjectId?: string, themeId?: string): Promise<ChatSession[]> => {
            const params = new URLSearchParams();
            params.append('student_id', studentId);
            if (questId) params.append('quest_id', questId);
            if (projectId) params.append('project_id', projectId);
            if (subjectId) params.append('subject_id', subjectId);
            if (themeId) params.append('theme_id', themeId);
            params.append('lang', this.getLang());
            return this.get<ChatSession[]>(`/chat/sessions?${params.toString()}`);
        },
        get: async (id: string): Promise<ChatSession> => {
            return this.get<ChatSession>(this.appendLang(`/chat/sessions/${id}`))
        },
        create: async (data: Partial<ChatSession>): Promise<ChatSession> => {
            return this.post<ChatSession>('/chat/sessions', data)
        },
        delete: async (sessionId: string): Promise<void> => {
            const response = await fetch(`${this.baseUrl}/chat/sessions/${sessionId}`, {
                method: 'DELETE',
                credentials: 'include',
            });
            if (response.status === 401) this.handleUnauthorized();
        },
        summarize: async (sessionId: string): Promise<ChatSession> => {
            return this.post<ChatSession>(`/chat/sessions/${sessionId}/summarize`, {});
        },
    }

    chatMessages = {
        list: async (sessionId: string): Promise<ChatMessage[]> => {
            return this.get<ChatMessage[]>(`/chat/sessions/${sessionId}/messages`)
        },
        create: async (data: Partial<ChatMessage>): Promise<ChatMessage> => {
            return this.post<ChatMessage>('/chat/messages', data)
        },
    }

    assessments = {
        // Assessment Domains
        listDomains: async (): Promise<AssessmentDomain[]> => {
            return this.get<AssessmentDomain[]>(this.appendLang('/assessments/domains'));
        },
        getDomain: async (id: string): Promise<AssessmentDomain> => {
            return this.get<AssessmentDomain>(`/assessments/domains/${id}`);
        },

        // Rubrics
        createRubric: async (data: Partial<Rubric>): Promise<Rubric> => {
            return this.post<Rubric>('/assessments/rubrics', data);
        },
        listRubrics: async (themeId?: string, exerciseId?: string): Promise<Rubric[]> => {
            const params = new URLSearchParams();
            if (themeId) params.append('theme_id', themeId);
            if (exerciseId) params.append('exercise_id', exerciseId);
            const query = params.toString() ? `?${params.toString()}` : '';
            return this.get<Rubric[]>(`/assessments/rubrics${query}`);
        },
        getRubric: async (id: string): Promise<Rubric> => {
            return this.get<Rubric>(`/assessments/rubrics/${id}`);
        },

        // Rubric Criteria
        createCriterion: async (data: Partial<RubricCriterion>): Promise<RubricCriterion> => {
            return this.post<RubricCriterion>('/assessments/criteria', data);
        },
        listCriteria: async (rubricId: string): Promise<RubricCriterion[]> => {
            return this.get<RubricCriterion[]>(`/assessments/rubrics/${rubricId}/criteria`);
        },

        // Performance Levels
        createPerformanceLevel: async (data: Partial<PerformanceLevel>): Promise<PerformanceLevel> => {
            return this.post<PerformanceLevel>('/assessments/performance-levels', data);
        },
        listPerformanceLevels: async (rubricId: string): Promise<PerformanceLevel[]> => {
            return this.get<PerformanceLevel[]>(`/assessments/rubrics/${rubricId}/performance-levels`);
        },

        // Criterion Descriptors
        createDescriptor: async (data: Partial<CriterionDescriptor>): Promise<CriterionDescriptor> => {
            return this.post<CriterionDescriptor>('/assessments/descriptors', data);
        },
        listDescriptors: async (criterionId: string): Promise<CriterionDescriptor[]> => {
            return this.get<CriterionDescriptor[]>(`/assessments/criteria/${criterionId}/descriptors`);
        },

        // Student Domain Performance
        createStudentDomainPerformance: async (data: Partial<StudentDomainPerformance>): Promise<StudentDomainPerformance> => {
            return this.post<StudentDomainPerformance>('/assessments/domain-performance', data);
        },
        listStudentDomainPerformance: async (studentId: string, themeId?: string, exerciseId?: string): Promise<StudentDomainPerformance[]> => {
            const params = new URLSearchParams();
            if (themeId) params.append('theme_id', themeId);
            if (exerciseId) params.append('exercise_id', exerciseId);
            const query = params.toString() ? `?${params.toString()}` : '';
            return this.get<StudentDomainPerformance[]>(`/assessments/domain-performance/${studentId}${query}`);
        },

        // Portfolio Artifacts
        createPortfolioArtifact: async (data: Partial<PortfolioArtifact>): Promise<PortfolioArtifact> => {
            return this.post<PortfolioArtifact>('/assessments/portfolio-artifacts', data);
        },
        listPortfolioArtifacts: async (studentId: string, themeId?: string, exerciseId?: string): Promise<PortfolioArtifact[]> => {
            const params = new URLSearchParams();
            if (themeId) params.append('theme_id', themeId);
            if (exerciseId) params.append('exercise_id', exerciseId);
            const query = params.toString() ? `?${params.toString()}` : '';
            return this.get<PortfolioArtifact[]>(`/assessments/portfolio-artifacts/${studentId}${query}`);
        },

        // Student Levels Update
        updateStudentLevels: async (studentId: string, data: StudentLevelsUpdate): Promise<any> => {
            return this.put<any>(`/students/${studentId}/levels`, data); // Assuming an endpoint like this exists or will be created
        },
    };
    quests = {
        list: async (lang: string = "en"): Promise<Quest[]> => {
            return this.get<Quest[]>(`/quests/?lang=${lang}`)
        },
        getPrompts: async (questId: string, limit: number = 4, lang: string = "en"): Promise<any[]> => {
            return this.get<any[]>(`/quests/${questId}/prompts?limit=${limit}&lang=${lang}`)
        },
    }

    projects = {
        list: async (studentId: string): Promise<Project[]> => {
            return this.get<Project[]>(`/projects?student_id=${studentId}`)
        },
        get: async (projectId: string): Promise<Project> => {
            return this.get<Project>(`/projects/${projectId}`)
        },
        create: async (data: { student_id: string; name: string; description?: string }): Promise<Project> => {
            return this.post<Project>('/projects', data)
        },
        update: async (projectId: string, data: { name?: string; description?: string }): Promise<Project> => {
            return this.put<Project>(`/projects/${projectId}`, data)
        },
        delete: async (projectId: string): Promise<void> => {
            const response = await fetch(`${this.baseUrl}/projects/${projectId}`, {
                method: 'DELETE',
                credentials: 'include',
            })
            if (response.status === 401) this.handleUnauthorized();
        },
        listFiles: async (projectId: string): Promise<ProjectFile[]> => {
            return this.get<ProjectFile[]>(`/projects/${projectId}/files`)
        },
        uploadFile: async (projectId: string, file: File, name?: string, description?: string): Promise<ProjectFile> => {
            const formData = new FormData()
            formData.append('file', file)
            if (name) formData.append('name', name)
            if (description) formData.append('description', description)

            try {
                const response = await fetch(`${this.baseUrl}/projects/${projectId}/files`, {
                    method: 'POST',
                    credentials: 'include',
                    body: formData,
                })
                if (response.status === 401) this.handleUnauthorized();
                if (!response.ok) {
                    const errorText = await response.text().catch(() => response.statusText)
                    throw new Error(`Upload failed: ${errorText}`)
                }
                return response.json()
            } catch (error) {
                if (error instanceof TypeError && error.message === 'Failed to fetch') {
                    throw new Error('Cannot reach server. Please check your connection and ensure the API is running.')
                }
                throw error
            }
        },
        deleteFile: async (projectId: string, fileId: string): Promise<void> => {
            const response = await fetch(`${this.baseUrl}/projects/${projectId}/files/${fileId}`, {
                method: 'DELETE',
                credentials: 'include',
            })
            if (response.status === 401) this.handleUnauthorized();
        },
    }

    voice = {
        saveExchange: async (data: {
            student_id: string
            user_message: string
            assistant_message: string
            session_id?: string
            quest_id?: string
            project_id?: string
            subject_id?: string
            theme_id?: string
        }): Promise<{ session_id: string; session_preview?: string; is_new_session: boolean }> => {
            return this.post('/voice/save-exchange', data)
        },
    }

    placementQuestions = {
        getAssessment: async (subjectId: string): Promise<PlacementQuestionsListResponse> => {
            return this.get<PlacementQuestionsListResponse>(this.appendLang(`/placement-questions/subject/${subjectId}/assessment`))
        },
        list: async (subjectId: string, phaseId?: string): Promise<any[]> => {
            const params = new URLSearchParams()
            if (phaseId) params.append('phase_id', phaseId)
            const query = params.toString() ? `?${params.toString()}` : ''
            return this.get<any[]>(`/placement-questions/subject/${subjectId}${query}`)
        },
        get: async (questionId: string): Promise<any> => {
            return this.get<any>(`/placement-questions/${questionId}`)
        },
    }

    studentAssessments = {
        start: async (data: AssessmentStartRequest): Promise<AssessmentStartResponse> => {
            return this.post<AssessmentStartResponse>(this.appendLang('/student-assessments/start'), data)
        },
        resume: async (assessmentId: string): Promise<AssessmentResumeResponse> => {
            return this.get<AssessmentResumeResponse>(this.appendLang(`/student-assessments/${assessmentId}/resume`))
        },
        saveProgress: async (assessmentId: string, data: AssessmentSaveProgressRequest): Promise<AssessmentProgressResponse> => {
            return this.put<AssessmentProgressResponse>(`/student-assessments/${assessmentId}/progress`, data)
        },
        submit: async (data: StudentAssessmentSubmit): Promise<AssessmentResultResponse> => {
            return this.post<AssessmentResultResponse>(this.appendLang('/student-assessments/submit'), data)
        },
        listByStudent: async (studentId: string): Promise<StudentAssessmentSummary[]> => {
            return this.get<StudentAssessmentSummary[]>(this.appendLang(`/student-assessments/student/${studentId}`))
        },
        getBySubject: async (studentId: string, subjectId: string): Promise<any> => {
            return this.get<any>(`/student-assessments/student/${studentId}/subject/${subjectId}`)
        },
        get: async (assessmentId: string): Promise<StudentAssessmentDetail> => {
            return this.get<StudentAssessmentDetail>(`/student-assessments/${assessmentId}`)
        },
        reset: async (studentId: string, subjectId?: string): Promise<{ message: string; deleted_count: number }> => {
            const params = subjectId ? `?subject_id=${subjectId}` : ''
            return this.delete<{ message: string; deleted_count: number }>(`/student-assessments/student/${studentId}/reset${params}`)
        },
    }

    studentPreferences = {
        get: async (studentId: string): Promise<StudentPreferences> => {
            // Preferences are stored in students.placement_data in zingbee-rt
            return this.get<StudentPreferences>(`/academy/student/${studentId}/progress`)
        },
        checkPlacement: async (studentId: string, subjectId: string): Promise<PlacementCheckResponse> => {
            return this.get<PlacementCheckResponse>(`/student-assessments/student/${studentId}/placement/${subjectId}`)
        },
        update: async (studentId: string, data: Partial<StudentPreferences>): Promise<StudentPreferences> => {
            // No-op for now - placement is updated via assessment submission
            return {} as StudentPreferences
        },
    }
}

export const apiClient = new ApiClient()
