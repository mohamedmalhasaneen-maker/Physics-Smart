export type TrackId = 'thanawiya' | 'baccalaureate' | 'american';
export type UserTrackState = TrackId | 'unset';
export type Language = 'ar' | 'en';
export type ThemeMode = 'dark' | 'light';
export type UserRole = 'student' | 'admin';

export type NavSection =
  | 'dashboard'
  | 'curriculum'
  | 'formulas'
  | 'lab'
  | 'graphing'
  | 'questions'
  | 'exams'
  | 'tutor'
  | 'solver'
  | 'planner'
  | 'challenges'
  | 'analytics'
  | 'admin';

export interface UserProfile {
  uid: string;
  displayName: string;
  email: string;
  photoURL?: string;
  track: UserTrackState;
  grade: string;
  preferredLang: Language;
  role: UserRole;
  points: number;
  level: number;
  badges?: string[];
  createdAt?: any;
  updatedAt?: any;
}

export interface BilingualText {
  ar: string;
  en: string;
}

export interface ScientificTerm {
  termAr: string;
  termEn: string;
  definitionAr: string;
  definitionEn: string;
}

export interface SymbolUnitRow {
  symbol: string;
  nameAr: string;
  nameEn: string;
  unitAr: string;
  unitEn: string;
}

export interface SolvedExample {
  id: string;
  titleAr: string;
  titleEn: string;
  problemAr: string;
  problemEn: string;
  givensAr: string[];
  givensEn: string[];
  formulaLatex: string;
  stepsAr: string[];
  stepsEn: string[];
  finalAnswer: string;
}

export interface LessonPart {
  id: string;
  titleAr: string;
  titleEn: string;
  explanationAr: string;
  explanationEn: string;
  equationsLatex?: string[];
  diagramType?: 'kinematics' | 'circuit' | 'wave' | 'optics' | 'magnetism' | 'freefall' | 'newton';
  checkQuestion?: {
    questionAr: string;
    questionEn: string;
    optionsAr: string[];
    optionsEn: string[];
    correctIndex: number;
    explanationAr: string;
    explanationEn: string;
  };
}

export interface Lesson {
  id: string;
  track: TrackId;
  grade: string;
  termAr: string;
  termEn: string;
  unitId: string;
  unitTitleAr: string;
  unitTitleEn: string;
  order: number;
  sourceType: 'platform_reference' | 'imported_official';
  sourceLabelAr: string;
  sourceLabelEn: string;
  titleAr: string;
  titleEn: string;
  estimatedMinutes: number;
  // 15 mandatory sections
  introAr: string;
  introEn: string;
  objectivesAr: string[];
  objectivesEn: string[];
  parts: LessonPart[]; // Detailed scientific explanation + diagrams + interactive check questions
  conceptsAr: Array<{ title: string; body: string }>;
  conceptsEn: Array<{ title: string; body: string }>;
  terms: ScientificTerm[];
  lawsLatex: Array<{ nameAr: string; nameEn: string; latex: string; noteAr: string; noteEn: string }>;
  symbolsTable: SymbolUnitRow[];
  everydayExamplesAr: string[];
  everydayExamplesEn: string[];
  solvedExamples: SolvedExample[];
  gradedProblems: Array<{
    level: 'easy' | 'medium' | 'hard';
    problemAr: string;
    problemEn: string;
    hintAr: string;
    hintEn: string;
    answer: string;
  }>;
  commonMistakesAr: Array<{ mistake: string; correction: string }>;
  commonMistakesEn: Array<{ mistake: string; correction: string }>;
  practicalAppsAr: string[];
  practicalAppsEn: string[];
  summaryAr: string[];
  summaryEn: string[];
  finalQuizQuestionIds: string[];
  resourceUrls?: { pdf?: string; video?: string; image?: string };
}

export interface FormulaItem {
  id: string;
  category:
    | 'kinematics'
    | 'newton'
    | 'work_energy'
    | 'power'
    | 'momentum'
    | 'electricity'
    | 'magnetism'
    | 'waves'
    | 'sound'
    | 'optics';
  nameAr: string;
  nameEn: string;
  latex: string;
  symbolsSearch: string; // e.g., "F m a force mass acceleration"
  symbols: SymbolUnitRow[];
  conditionsAr: string;
  conditionsEn: string;
  relatedFormulas: string[];
  exampleAr: string;
  exampleEn: string;
  commonErrorsAr: string;
  commonErrorsEn: string;
  linkedLessonIds: string[];
}

export type QuestionType =
  | 'mcq'
  | 'true_false'
  | 'fill_blank'
  | 'numerical'
  | 'explanation'
  | 'graph_analysis'
  | 'experiment';

export type Difficulty = 'easy' | 'medium' | 'hard' | 'advanced';

export interface QuestionItem {
  id: string;
  track: TrackId;
  grade: string;
  termAr: string;
  termEn: string;
  unitId: string;
  lessonId: string;
  type: QuestionType;
  difficulty: Difficulty;
  textAr: string;
  textEn: string;
  optionsAr?: string[];
  optionsEn?: string[];
  correctAnswer: string; // index as string for mcq/tf, or expected text/number
  numericValue?: number;
  numericUnit?: string;
  tolerance?: number; // e.g., 0.02 = 2%
  explanationAr: string;
  explanationEn: string;
  wrongOptionReasonsAr?: string[];
  wrongOptionReasonsEn?: string[];
  skillAr: string;
  skillEn: string;
  sourceAr: string;
  sourceEn: string;
}

export interface ExamBlueprint {
  id: string;
  track: TrackId;
  grade: string;
  examType: 'lesson' | 'unit' | 'comprehensive' | 'mock';
  titleAr: string;
  titleEn: string;
  durationMinutes: number;
  difficulty: Difficulty | 'mixed';
  questionIds: string[];
  passingScore: number;
}

export interface ExamAttempt {
  id: string;
  userId: string;
  examId: string;
  examTitle: string;
  track: TrackId;
  status: 'in_progress' | 'submitted';
  score: number;
  maxScore: number;
  answersJson?: string;
  startedAt?: any;
  updatedAt?: any;
}

export interface LessonProgress {
  userId: string;
  lessonId: string;
  track: TrackId;
  completedParts?: string[];
  isCompleted: boolean;
  quizScore: number;
  studyMinutes: number;
  lastAccessedAt?: any;
  updatedAt?: any;
}

export interface StudyTask {
  id: string;
  userId: string;
  title: string;
  track: TrackId;
  lessonId?: string;
  scheduledDate: string;
  durationMinutes: number;
  taskType: 'study' | 'practice' | 'review' | 'exam';
  completed: boolean;
  createdAt?: any;
  updatedAt?: any;
}

export interface TutorMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: string;
  attachmentName?: string;
}

export interface TutorSession {
  id: string;
  userId: string;
  title: string;
  mode: 'tutor' | 'analyzer' | 'examiner';
  track: TrackId;
  messagesJson: string;
  createdAt?: any;
  updatedAt?: any;
}

export interface LabExperimentConfig {
  id: string;
  category: 'mechanics' | 'electricity' | 'waves' | 'magnetism' | 'optics';
  simKey:
    | 'linear_freefall'
    | 'projectile'
    | 'newton_incline'
    | 'collisions'
    | 'ohms_circuits'
    | 'waves_interference'
    | 'magnetism_induction'
    | 'optics_bench';
  titleAr: string;
  titleEn: string;
  descriptionAr: string;
  descriptionEn: string;
  equationsLatex: string[];
  procedureAr: string[];
  procedureEn: string[];
  scientificExplanationAr: string;
  scientificExplanationEn: string;
  postQuestions: Array<{
    qAr: string;
    qEn: string;
    optionsAr: string[];
    optionsEn: string[];
    correctIndex: number;
    reasonAr: string;
    reasonEn: string;
  }>;
}

export interface ChallengeItem {
  id: string;
  kind: 'daily' | 'weekly' | 'calculation' | 'concept';
  track: TrackId | 'all';
  titleAr: string;
  titleEn: string;
  points: number;
  question: QuestionItem;
}

export interface LeaderboardEntry {
  uid: string;
  displayName: string;
  track: TrackId;
  grade: string;
  points: number;
  accuracy: number;
  level: number;
  updatedAt?: any;
}

export interface SavedGraph {
  id: string;
  userId: string;
  title: string;
  graphType: string;
  xLabel?: string;
  yLabel?: string;
  pointsJson: string;
  createdAt?: any;
  updatedAt?: any;
}
