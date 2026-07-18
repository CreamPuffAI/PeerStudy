export type QuestionType = 'multiple_choice' | 'numeric'
export type QuestionPurpose = 'target' | 'diagnostic' | 'practice' | 'checkpoint'
export type MasteryStatus = 'unknown' | 'learning' | 'needs_support' | 'mastered'
export type LearningStepType = 'micro_explanation' | 'worked_example' | 'practice' | 'checkpoint' | 'return_to_target'
export type NextAction = 'continue_diagnostic' | 'start_learning_path' | 'continue_practice' | 'return_to_target' | 'completed'
export type DiagnosisStatus = 'in_progress' | 'completed' | 'cancelled'
export type DiagnosisClassification = 'knowledge_gap' | 'careless_mistake' | 'insufficient_evidence'
export type LearningPathStatus = 'not_started' | 'in_progress' | 'completed'
export type FeedbackType = 'success' | 'neutral' | 'warning' | 'error'
export type Severity = 'low' | 'medium' | 'high'
export type PriorityLevel = 'low' | 'medium' | 'high'
export type SyncEventType = 'question_attempted' | 'learning_step_completed' | 'checkpoint_completed' | 'learning_path_completed'
export type SyncRejectCode = 'INVALID_EVENT' | 'QUESTION_NOT_FOUND' | 'PACKAGE_VERSION_MISMATCH' | 'SESSION_NOT_FOUND' | 'STUDENT_NOT_FOUND'

export interface ApiSuccessResponse<T> {
  success: true
  data: T
  meta?: Record<string, unknown>
}

export interface ApiErrorResponse {
  success: false
  error: {
    code: string
    message: string
    details?: Record<string, unknown>
  }
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse

export interface AIContentConstraints {
  questionType?: QuestionType
  difficulty?: number
  denominatorMax?: number
  singleCorrectAnswer?: boolean
  mustIncludeValidation?: boolean
  mustIncludeErrorMappings?: boolean
  allowedPurpose?: QuestionPurpose
  allowedErrorPatterns?: string[]
  maxSentences?: number
  maxWords?: number
}

export interface GenerateDiagnosisHintRequest {
  packageId: string
  diagnosisSessionId: string
  style?: string
  constraints?: Pick<AIContentConstraints, 'maxSentences' | 'maxWords'>
}

export interface GenerateDiagnosisHintResponse {
  id: string
  skillId: string
  sourceContentId: string
  style: string
  message: string
  generated: boolean
  fallbackUsed: boolean
}

export interface RewriteExplanationRequest {
  packageId: string
  skillId: string
  contentId: string
  style?: string
  constraints?: AIContentConstraints
}

export interface RewriteExplanationResponse {
  id: string
  skillId: string
  sourceContentId: string
  style: string
  content: string
  generated: boolean
  fallbackUsed: boolean
}

export interface GenerateQuestionVariantRequest {
  packageId: string
  skillId: string
  questionId: string
  style?: string
  constraints?: AIContentConstraints
}

export interface GenerateQuestionVariantResponse extends Question {
  sourceQuestionId: string
  style: string
  generated: boolean
  fallbackUsed: boolean
}

export interface Skill {
  id: string
  name: string
  grade: number
  domain: string
  prerequisiteIds: string[]
  masteryThreshold: number
}

export interface QuestionOption {
  id: string
  text: string
}

export interface QuestionValidation {
  correctAnswer: string
  acceptedAnswers?: string[]
  tolerance?: number
}

export interface Question {
  id: string
  skillId: string
  purpose: QuestionPurpose
  type: QuestionType
  difficulty?: number
  prompt: string
  options?: QuestionOption[]
  validation?: QuestionValidation
  errorMappings?: Record<string, string>
}

export interface Explanation {
  id: string
  skillId: string
  style: string
  content: string
}

export interface DiagnosticRuleCandidate {
  skillId: string
  weight: number
}

export interface DiagnosticRule {
  id: string
  triggerErrorPattern: string
  candidateSkills: DiagnosticRuleCandidate[]
}

export interface WorkedExample {
  id: string
  skillId: string
  title: string
  steps: string[]
}

export interface LearningPackage {
  packageId: string
  version: number
  name: string
  updatedAt: string
  skills: Skill[]
  questions: Question[]
  explanations: Explanation[]
  workedExamples?: WorkedExample[]
  learningPaths?: LearningPath[]
  diagnosticRulesVersion?: number
  diagnosticRules?: DiagnosticRule[]
}

export interface AttemptRequest {
  eventId: string
  studentId: string
  classId: string
  packageId: string
  questionId: string
  purpose: QuestionPurpose
  context: {
    diagnosisSessionId?: string
    learningPathId?: string
    learningStepId?: string
  }
  answer: {
    type: QuestionType
    value: string
  }
  responseTimeMs: number
  attemptNumber: number
  deviceTimestamp: string
  offlineCreated: boolean
}

export interface SkillUpdate {
  skillId: string
  previousMastery: number
  currentMastery: number
  status: MasteryStatus
}

export interface NextStep {
  action: NextAction
  questionId?: string
  diagnosisSessionId?: string
  learningPathId?: string
}

export interface Feedback {
  type: FeedbackType
  message: string
}

export interface DetectedErrorPattern {
  code: string
  label: string
  confidence: number
}

export interface CandidateSkill {
  skillId: string
  name: string
  suspicionScore: number
}

export interface DiagnosisSessionInfo {
  id: string
  status: DiagnosisStatus
  answeredCount: number
  maxQuestions: number
}

export interface AttemptCorrectResponse {
  attemptId: string
  correct: true
  skillUpdate: SkillUpdate
  next: NextStep
  feedback: Feedback
}

export interface AttemptWrongResponse {
  attemptId: string
  correct: false
  detectedErrorPattern: DetectedErrorPattern
  candidateSkills: CandidateSkill[]
  diagnosisSession: DiagnosisSessionInfo
  next: NextStep
  feedback: Feedback
}

export type AttemptResponse = AttemptCorrectResponse | AttemptWrongResponse

export interface DiagnosisCandidate {
  skillId: string
  name: string
  score: number
}

export interface DiagnosisEvidence {
  type: string
  skillId?: string
  message: string
}

export interface DiagnosisResult {
  rootGap: {
    skillId: string
    name: string
    grade: number
  } | null
  confidence: number
  classification: DiagnosisClassification
  evidence: DiagnosisEvidence[]
}

export interface DiagnosisSession {
  id: string
  studentId: string
  triggerQuestionId: string
  triggerSkillId: string
  status: DiagnosisStatus
  answeredCount: number
  maxQuestions: number
  candidates: DiagnosisCandidate[]
  nextQuestion?: Question
  diagnosis?: DiagnosisResult
  learningPath?: LearningPath
  next?: NextStep
}

export interface LearningStep {
  id: string
  order: number
  type: LearningStepType
  skillId: string
  contentId?: string
  questionIds?: string[]
}

export interface LearningPath {
  id: string
  targetSkillId: string
  rootGapSkillId: string
  status: LearningPathStatus
  estimatedMinutes: number
  steps: LearningStep[]
}

export interface SyncEvent {
  eventId: string
  type: SyncEventType
  createdAt: string
  payload: Record<string, unknown>
}

export interface SyncRequest {
  deviceId: string
  studentId: string
  packageId: string
  packageVersion: number
  events: SyncEvent[]
}

export interface SyncResponse {
  acceptedEventIds: string[]
  duplicateEventIds: string[]
  rejectedEvents: {
    eventId: string
    code: SyncRejectCode
    message: string
    retryable: boolean
  }[]
  serverTimestamp: string
}

export interface ClassInfo {
  id: string
  name: string
  studentCount: number
}

export interface SyncStatus {
  syncedStudents: number
  offlineStudents: number
  lastUpdatedAt: string
}

export interface ClassSummary {
  studentsNeedSupport: number
  studentsOnTrack: number
  studentsReadyForAdvanced: number
  averagePreTestScore: number
  averagePostTestScore: number
}

export interface CommonGap {
  skillId: string
  skillName: string
  grade: number
  studentCount: number
  percentage: number
  severity: Severity
  affectedSkills: string[]
}

export interface StudentGroup {
  id: string
  name: string
  skillId: string
  studentCount: number
  studentIds: string[]
  recommendedAction: string
}

export interface PriorityStudent {
  studentId: string
  studentName: string
  priorityScore: number
  priorityLevel: PriorityLevel
  rootGapSkillId: string
  rootGapSkillName: string
  reasons: string[]
}

export interface ReteachSuggestion {
  skillId: string
  title: string
  reason: string
  estimatedMinutes: number
  priority: number
  activities: string[]
}

export interface ClassInsights {
  class: ClassInfo
  syncStatus: SyncStatus
  summary: ClassSummary
  commonGaps: CommonGap[]
  groups: StudentGroup[]
  priorityStudents: PriorityStudent[]
  reteachSuggestions: ReteachSuggestion[]
}

export interface Student {
  id: string
  name: string
  classId: string
  grade: number
  persona: string
  currentLesson: {
    skillId: string
    questionId: string
  }
  mastery: {
    skillId: string
    masteryScore: number
    status: MasteryStatus
  }[]
  groundTruthRootGapSkillId: string | null
}
