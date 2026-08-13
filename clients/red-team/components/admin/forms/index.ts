import type { ReactElement } from "react";
import type { RowFormProps } from "./types";
import { SubjectsForm } from "./SubjectsForm";
import { SubjectCurriculumForm } from "./SubjectCurriculumForm";
import { CurriculumThemesForm } from "./CurriculumThemesForm";
import { CurriculumCapsulesForm } from "./CurriculumCapsulesForm";
import { CurriculumFactsForm } from "./CurriculumFactsForm";
import { UsersForm } from "./UsersForm";
import { StudentsForm } from "./StudentsForm";
import { LearningSessionsForm } from "./LearningSessionsForm";
import { LearningSessionMessagesForm } from "./LearningSessionMessagesForm";
import { LearningSessionFeedbackForm } from "./LearningSessionFeedbackForm";
import { AgentsForm } from "./AgentsForm";
import { EvalRunsForm } from "./EvalRunsForm";

type FormComponent = (props: RowFormProps) => ReactElement;

const FORM_REGISTRY: Record<string, FormComponent> = {
  subjects: SubjectsForm,
  subject_curriculum: SubjectCurriculumForm,
  curriculum_themes: CurriculumThemesForm,
  curriculum_capsules: CurriculumCapsulesForm,
  curriculum_facts: CurriculumFactsForm,
  users: UsersForm,
  students: StudentsForm,
  learning_sessions: LearningSessionsForm,
  learning_session_messages: LearningSessionMessagesForm,
  learning_session_feedback: LearningSessionFeedbackForm,
  agents: AgentsForm,
  eval_runs: EvalRunsForm,
};

export function getFormComponent(tableName: string): FormComponent | null {
  return FORM_REGISTRY[tableName] || null;
}

export type { RowFormProps };
