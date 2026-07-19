import type { AttemptRequest, LearningPackage, LearningStep, Question, WorkedExample } from '../types/api'

export function getWorkedExampleById(
  learningPackage: LearningPackage,
  exampleId: string,
): WorkedExample | undefined {
  return learningPackage.workedExamples?.find(example => example.id === exampleId)
}

export function getOrderedLearningSteps(steps: LearningStep[]): LearningStep[] {
  return [...steps].sort((left, right) => left.order - right.order)
}

export function createLearningAttempt({
  eventId,
  studentId,
  classId,
  packageId,
  question,
  answer,
  learningPathId,
  learningStepId,
  responseTimeMs,
  deviceTimestamp,
  offlineCreated,
}: {
  eventId: string
  studentId: string
  classId: string
  packageId: string
  question: Question
  answer: string
  learningPathId: string
  learningStepId: string
  responseTimeMs: number
  deviceTimestamp: string
  offlineCreated: boolean
}): AttemptRequest {
  return {
    eventId,
    studentId,
    classId,
    packageId,
    questionId: question.id,
    purpose: question.purpose,
    context: { learningPathId, learningStepId },
    answer: { type: question.type, value: answer },
    responseTimeMs,
    attemptNumber: 1,
    deviceTimestamp,
    offlineCreated,
  }
}
