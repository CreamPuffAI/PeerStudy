import { useState, useEffect, useRef } from 'react'
import { BookOpen, PenTool, CheckCircle, ArrowRight, RotateCcw, Lightbulb, Eye } from 'lucide-react'
import type { LearningPath, LearningPackage, NextAction, Question, Explanation } from '../../types/api'
import { submitAttempt } from '../../lib/api'
import { QuestionCard } from './QuestionCard'
import { Card, CardHeader } from '../ui/Card'
import { Button } from '../ui/Button'
import { ProgressBar } from '../ui/ProgressBar'

interface LearningPathViewProps {
  path: LearningPath
  studentId: string
  packageId: string
  learningPackage: LearningPackage
  onComplete: (nextAction: NextAction) => void
}

export function LearningPathView({ path, studentId, packageId, learningPackage, onComplete }: LearningPathViewProps) {
  const [currentStepIndex, setCurrentStepIndex] = useState(0)
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'neutral' | 'error'; message: string } | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [completedSteps, setCompletedSteps] = useState<Set<string>>(new Set())

  const answerStartRef = useRef(Date.now())
  const attemptCountsRef = useRef<Record<string, number>>({})
  const advancingRef = useRef(false)

  const currentStep = path.steps[currentStepIndex]
  const progress = ((completedSteps.size) / path.steps.length) * 100

  useEffect(() => {
    answerStartRef.current = Date.now()
  }, [currentStep?.id])

  useEffect(() => {
    setCurrentQuestionIndex(0)
  }, [currentStepIndex])

  const getQuestionById = (id: string): Question | undefined =>
    learningPackage.questions.find(q => q.id === id)

  const getExplanationById = (id: string): Explanation | undefined =>
    learningPackage.explanations.find(e => e.id === id)

  const currentQuestionId = currentStep?.questionIds?.[currentQuestionIndex]
  const currentQuestion = currentQuestionId ? getQuestionById(currentQuestionId) : undefined
  const isLastQuestionInStep = currentStep?.questionIds
    ? currentQuestionIndex >= currentStep.questionIds.length - 1
    : true

  function advanceStep() {
    if (advancingRef.current) return
    advancingRef.current = true

    const newCompleted = new Set(completedSteps)
    newCompleted.add(currentStep.id)
    setCompletedSteps(newCompleted)

    if (currentStepIndex < path.steps.length - 1) {
      setCurrentStepIndex(currentStepIndex + 1)
      setFeedback(null)
      setSubmitted(false)
    } else {
      setTimeout(() => onComplete('completed'), 800)
    }
    advancingRef.current = false
  }

  function handleStepComplete() {
    if (advancingRef.current) return
    advanceStep()
  }

  async function handleAnswer(answer: string) {
    if (!currentQuestion || submitted || advancingRef.current) return
    setSubmitted(true)
    setFeedback(null)

    try {
      const responseTimeMs = Date.now() - answerStartRef.current
      const attemptKey = currentQuestion.id
      const currentAttempt = attemptCountsRef.current[attemptKey] ?? 0
      attemptCountsRef.current[attemptKey] = currentAttempt + 1

      const response = await submitAttempt({
        eventId: crypto.randomUUID(),
        studentId,
        classId: 'class-7a',
        packageId,
        questionId: currentQuestion.id,
        purpose: currentQuestion.purpose,
        context: { learningPathId: path.id, learningStepId: currentStep.id },
        answer: { type: currentQuestion.type, value: answer },
        responseTimeMs,
        attemptNumber: currentAttempt + 1,
        deviceTimestamp: new Date().toISOString(),
        offlineCreated: !navigator.onLine
      })

      const res = response as { correct: boolean; feedback: { type: string; message: string }; next: { action: NextAction } }
      setFeedback({
        type: res.correct ? 'success' : res.feedback.type === 'neutral' ? 'neutral' : 'error',
        message: res.feedback.message
      })

      if (res.correct || currentStep.type === 'practice') {
        if (isLastQuestionInStep) {
          setTimeout(advanceStep, 1200)
        } else {
          setTimeout(() => {
            setCurrentQuestionIndex(currentQuestionIndex + 1)
            setFeedback(null)
            setSubmitted(false)
          }, 1200)
        }
      } else {
        setSubmitted(false)
      }
    } catch {
      setFeedback({ type: 'error', message: 'Có lỗi xảy ra. Vui lòng thử lại.' })
      setSubmitted(false)
    }
  }

  function getStepIcon(type: string) {
    switch (type) {
      case 'micro_explanation': return <Lightbulb className="w-4 h-4" />
      case 'worked_example': return <Eye className="w-4 h-4" />
      case 'practice': return <PenTool className="w-4 h-4" />
      case 'checkpoint': return <CheckCircle className="w-4 h-4" />
      case 'return_to_target': return <RotateCcw className="w-4 h-4" />
      default: return <BookOpen className="w-4 h-4" />
    }
  }

  function getStepLabel(type: string) {
    switch (type) {
      case 'micro_explanation': return 'Giải thích'
      case 'worked_example': return 'Ví dụ mẫu'
      case 'practice': return 'Luyện tập'
      case 'checkpoint': return 'Kiểm tra'
      case 'return_to_target': return 'Quay lại bài chính'
      default: return type
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title={`Lộ trình: ${learningPackage.skills.find(s => s.id === path.rootGapSkillId)?.name ?? 'Phục hồi'}`}
          subtitle={`Thời gian dự kiến: ${path.estimatedMinutes} phút`}
        />
        <ProgressBar value={progress} max={100} showLabel color="success" label="Tiến độ" />

        <div className="mt-4 flex gap-2 overflow-x-auto pb-2">
          {path.steps.map((step, idx) => (
            <div
              key={step.id}
              className={`
                flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium whitespace-nowrap
                ${idx === currentStepIndex ? 'bg-blue-100 text-blue-700 border border-blue-200' : ''}
                ${completedSteps.has(step.id) ? 'bg-emerald-100 text-emerald-700' : ''}
                ${idx > currentStepIndex && !completedSteps.has(step.id) ? 'bg-slate-100 text-slate-500' : ''}
              `}
            >
              {getStepIcon(step.type)}
              {getStepLabel(step.type)}
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <div className="flex items-center gap-2 mb-4">
          <span className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-100 text-blue-700 text-sm font-bold">
            {currentStepIndex + 1}
          </span>
          <h3 className="text-lg font-semibold text-slate-900">{getStepLabel(currentStep.type)}</h3>
        </div>

        {currentStep.type === 'micro_explanation' && currentStep.contentId && (
          <ExplanationStep
            explanation={getExplanationById(currentStep.contentId)}
            onComplete={handleStepComplete}
          />
        )}

        {currentStep.type === 'worked_example' && currentStep.contentId && (
          <WorkedExampleStep
            explanation={getExplanationById(currentStep.contentId)}
            onComplete={handleStepComplete}
          />
        )}

        {(currentStep.type === 'practice' || currentStep.type === 'checkpoint' || currentStep.type === 'return_to_target') && currentQuestion && (
          <QuestionCard
            key={currentQuestion.id}
            question={currentQuestion}
            onSubmit={handleAnswer}
            feedback={feedback}
            disabled={submitted}
          />
        )}
      </Card>
    </div>
  )
}

function ExplanationStep({ explanation, onComplete }: { explanation?: Explanation; onComplete: () => void }) {
  return (
    <div className="space-y-4">
      <div className="p-5 rounded-2xl bg-amber-50 border border-amber-100 text-slate-800 leading-relaxed">
        <div className="flex items-center gap-2 mb-3 text-amber-700 font-semibold">
          <Lightbulb className="w-5 h-5" />
          Kiến thức cần nhớ
        </div>
        <p className="text-base">{explanation?.content ?? 'Nội dung giải thích'}</p>
      </div>
      <Button onClick={onComplete}>
        Đã hiểu <ArrowRight className="w-4 h-4" />
      </Button>
    </div>
  )
}

function WorkedExampleStep({ explanation, onComplete }: { explanation?: Explanation; onComplete: () => void }) {
  return (
    <div className="space-y-4">
      <div className="p-5 rounded-2xl bg-blue-50 border border-blue-100">
        <div className="flex items-center gap-2 mb-3 text-blue-700 font-semibold">
          <Eye className="w-5 h-5" />
          Ví dụ mẫu
        </div>
        <div className="space-y-3 text-slate-800">
          <p className="text-base leading-relaxed">{explanation?.content ?? 'Nội dung ví dụ mẫu'}</p>
        </div>
      </div>
      <Button onClick={onComplete}>
        Đã hiểu <ArrowRight className="w-4 h-4" />
      </Button>
    </div>
  )
}
