import type {
  LearningPackage,
  ClassInsights,
  Student,
  LearningPath,
  DiagnosisSession,
  Question,
  Explanation,
  Skill
} from '../types/api'

const skills: Skill[] = [
  { id: 'F02', name: 'Nhận biết phân số', grade: 5, domain: 'fractions', prerequisiteIds: [], masteryThreshold: 0.8 },
  { id: 'F08', name: 'Phân số tương đương', grade: 5, domain: 'fractions', prerequisiteIds: ['F07'], masteryThreshold: 0.8 },
  { id: 'F11', name: 'Quy đồng mẫu số', grade: 5, domain: 'fractions', prerequisiteIds: ['F08'], masteryThreshold: 0.8 },
  { id: 'F14', name: 'Cộng trừ phân số khác mẫu', grade: 5, domain: 'fractions', prerequisiteIds: ['F11'], masteryThreshold: 0.8 },
  { id: 'R02', name: 'Quy tắc dấu với số hữu tỉ', grade: 7, domain: 'rationals', prerequisiteIds: ['F14'], masteryThreshold: 0.8 },
  { id: 'E01', name: 'Phương trình chứa phân số', grade: 7, domain: 'equations', prerequisiteIds: ['R02'], masteryThreshold: 0.8 }
]

const questions: Question[] = [
  {
    id: 'Q_E01_001',
    skillId: 'E01',
    purpose: 'target',
    type: 'multiple_choice',
    difficulty: 2,
    prompt: 'Giải phương trình: x + 1/2 = 3/4',
    options: [
      { id: 'A', text: 'x = 1/4' },
      { id: 'B', text: 'x = 5/4' },
      { id: 'C', text: 'x = 1/2' },
      { id: 'D', text: 'x = 1' }
    ],
    validation: { correctAnswer: 'A' },
    errorMappings: { B: 'ADD_DENOMINATORS', C: 'INCOMPLETE_MULTIPLE', D: 'USES_PRODUCT_INSTEAD_OF_LCM' }
  },
  {
    id: 'DQ_F11_002',
    skillId: 'F11',
    purpose: 'diagnostic',
    type: 'multiple_choice',
    difficulty: 1,
    prompt: 'Mẫu số chung nhỏ nhất của 4 và 6 là bao nhiêu?',
    options: [
      { id: 'A', text: '8' },
      { id: 'B', text: '10' },
      { id: 'C', text: '12' },
      { id: 'D', text: '24' }
    ],
    validation: { correctAnswer: 'C' },
    errorMappings: { A: 'INCOMPLETE_MULTIPLE', B: 'ADD_DENOMINATORS', D: 'USES_PRODUCT_INSTEAD_OF_LCM' }
  },
  {
    id: 'DQ_F08_001',
    skillId: 'F08',
    purpose: 'diagnostic',
    type: 'multiple_choice',
    difficulty: 1,
    prompt: 'Phân số tương đương với 1/2 là?',
    options: [
      { id: 'A', text: '2/3' },
      { id: 'B', text: '2/4' },
      { id: 'C', text: '3/5' },
      { id: 'D', text: '1/3' }
    ],
    validation: { correctAnswer: 'B' },
    errorMappings: {}
  },
  {
    id: 'DQ_F14_001',
    skillId: 'F14',
    purpose: 'diagnostic',
    type: 'multiple_choice',
    difficulty: 2,
    prompt: 'Tính 1/2 + 1/3.',
    options: [
      { id: 'A', text: '2/5' },
      { id: 'B', text: '5/6' },
      { id: 'C', text: '1/5' },
      { id: 'D', text: '3/6' }
    ],
    validation: { correctAnswer: 'B' },
    errorMappings: {
      A: 'ADD_NUMERATORS_AND_DENOMINATORS',
      C: 'SUBTRACT_INSTEAD_OF_ADD',
      D: 'INCOMPLETE_FRACTION_ADDITION'
    }
  },
  {
    id: 'P_F11_001',
    skillId: 'F11',
    purpose: 'practice',
    type: 'numeric',
    difficulty: 1,
    prompt: 'Tìm mẫu số chung nhỏ nhất của 3 và 5:',
    validation: { correctAnswer: '15', acceptedAnswers: ['15'], tolerance: 0 }
  },
  {
    id: 'CP_F11_001',
    skillId: 'F11',
    purpose: 'checkpoint',
    type: 'numeric',
    difficulty: 2,
    prompt: 'Quy đồng mẫu số và tính: 1/3 + 1/6 = ? (nhập dạng phân số, ví dụ 1/2)',
    validation: { correctAnswer: '1/2', acceptedAnswers: ['1/2', '0.5'], tolerance: 0.0001 }
  },
  {
    id: 'Q_E01_RETRY_001',
    skillId: 'E01',
    purpose: 'target',
    type: 'multiple_choice',
    difficulty: 2,
    prompt: 'Giải phương trình: 2x - 1/3 = 1/6',
    options: [
      { id: 'A', text: 'x = 1/4' },
      { id: 'B', text: 'x = 1/2' },
      { id: 'C', text: 'x = 1/6' },
      { id: 'D', text: 'x = 1/3' }
    ],
    validation: { correctAnswer: 'A' },
    errorMappings: {}
  }
]

const explanations: Explanation[] = [
  { id: 'EXP_F11_BASIC', skillId: 'F11', style: 'step_by_step', content: 'Muốn cộng hai phân số khác mẫu, trước hết cần đưa chúng về cùng mẫu số bằng cách tìm mẫu số chung nhỏ nhất (BCNN).' },
  { id: 'EXP_R02_SIGN', skillId: 'R02', style: 'step_by_step', content: 'Khi cộng hai số hữu tỉ trái dấu, lấy dấu của số có giá trị tuyệt đối lớn hơn.' }
]

export const learningPackage: LearningPackage = {
  packageId: 'math-fractions-v1',
  version: 3,
  name: 'Phân số và phương trình chứa phân số',
  updatedAt: '2026-07-17T10:00:00Z',
  skills,
  questions,
  explanations,
  diagnosticRulesVersion: 2,
  diagnosticRules: [
    { id: 'RULE-F11-01', triggerErrorPattern: 'ADD_DENOMINATORS', candidateSkills: [{ skillId: 'F11', weight: 0.75 }, { skillId: 'F08', weight: 0.25 }] },
    { id: 'RULE-R02-01', triggerErrorPattern: 'SIGN_ERROR', candidateSkills: [{ skillId: 'R02', weight: 0.9 }] }
  ]
}

export const classInsights: ClassInsights = {
  class: { id: 'class-7a', name: 'Lớp 7A', studentCount: 40 },
  syncStatus: { syncedStudents: 31, offlineStudents: 9, lastUpdatedAt: '2026-07-17T10:30:00Z' },
  summary: {
    studentsNeedSupport: 18,
    studentsOnTrack: 16,
    studentsReadyForAdvanced: 6,
    averagePreTestScore: 0.44,
    averagePostTestScore: 0.76
  },
  commonGaps: [
    {
      skillId: 'F11',
      skillName: 'Quy đồng mẫu số',
      grade: 5,
      studentCount: 12,
      percentage: 0.3,
      severity: 'high',
      affectedSkills: ['F14', 'R02', 'E01']
    },
    {
      skillId: 'R02',
      skillName: 'Quy tắc dấu với số hữu tỉ',
      grade: 7,
      studentCount: 8,
      percentage: 0.2,
      severity: 'medium',
      affectedSkills: ['E01']
    },
    {
      skillId: 'F08',
      skillName: 'Tạo phân số tương đương',
      grade: 5,
      studentCount: 4,
      percentage: 0.1,
      severity: 'medium',
      affectedSkills: ['F11', 'F14', 'E01']
    }
  ],
  groups: [
    {
      id: 'group-f11',
      name: 'Cần củng cố quy đồng',
      skillId: 'F11',
      studentCount: 12,
      studentIds: ['student-001', 'student-005', 'student-009', 'student-012', 'student-014', 'student-018', 'student-021', 'student-024', 'student-027', 'student-031', 'student-036', 'student-039'],
      recommendedAction: 'small_group_reteach'
    },
    {
      id: 'group-r02',
      name: 'Cần củng cố quy tắc dấu',
      skillId: 'R02',
      studentCount: 8,
      studentIds: ['student-002', 'student-006', 'student-010', 'student-016', 'student-020', 'student-026', 'student-033', 'student-038'],
      recommendedAction: 'targeted_practice'
    }
  ],
  priorityStudents: [
    {
      studentId: 'student-001',
      studentName: 'Minh',
      priorityScore: 0.91,
      priorityLevel: 'high',
      rootGapSkillId: 'F11',
      rootGapSkillName: 'Quy đồng mẫu số',
      reasons: ['Lỗ hổng ảnh hưởng đến ba kỹ năng phía sau', 'Sai lặp lại trong bốn lần làm bài', 'Chưa vượt qua checkpoint']
    },
    {
      studentId: 'student-002',
      studentName: 'Lan',
      priorityScore: 0.78,
      priorityLevel: 'medium',
      rootGapSkillId: 'R02',
      rootGapSkillName: 'Quy tắc dấu với số hữu tỉ',
      reasons: ['Sai dấu trong các phép tính số hữu tỉ', 'Kỹ năng này ảnh hưởng trực tiếp đến phương trình chứa phân số']
    }
  ],
  reteachSuggestions: [
    {
      skillId: 'F11',
      title: 'Ôn lại quy đồng mẫu số',
      reason: '12 học sinh đang gặp cùng một lỗ hổng.',
      estimatedMinutes: 12,
      priority: 1,
      activities: ['Nhắc lại cách tìm mẫu số chung nhỏ nhất', 'Thực hiện một ví dụ trực quan', 'Cho nhóm làm hai câu kiểm tra nhanh']
    },
    {
      skillId: 'R02',
      title: 'Ôn quy tắc dấu với số hữu tỉ',
      reason: '8 học sinh sai dấu khi cộng trừ số hữu tỉ.',
      estimatedMinutes: 8,
      priority: 2,
      activities: ['Tách phần dấu và phần giá trị tuyệt đối', 'Làm một ví dụ với hai phân số trái dấu', 'Cho nhóm làm một câu kiểm tra nhanh']
    }
  ]
}

export const demoStudents: Student[] = [
  {
    id: 'student-001',
    name: 'Minh',
    classId: 'class-7a',
    grade: 7,
    persona: 'Làm sai phương trình chứa phân số do thiếu kỹ năng quy đồng mẫu số.',
    currentLesson: { skillId: 'E01', questionId: 'Q_E01_001' },
    mastery: [
      { skillId: 'F08', masteryScore: 0.86, status: 'mastered' },
      { skillId: 'F11', masteryScore: 0.35, status: 'needs_support' },
      { skillId: 'F14', masteryScore: 0.48, status: 'learning' },
      { skillId: 'R02', masteryScore: 0.62, status: 'learning' },
      { skillId: 'E01', masteryScore: 0.42, status: 'learning' }
    ],
    groundTruthRootGapSkillId: 'F11'
  },
  {
    id: 'student-002',
    name: 'Lan',
    classId: 'class-7a',
    grade: 7,
    persona: 'Nắm được quy đồng nhưng hay sai quy tắc dấu với số hữu tỉ.',
    currentLesson: { skillId: 'E01', questionId: 'Q_E01_001' },
    mastery: [
      { skillId: 'F08', masteryScore: 0.84, status: 'mastered' },
      { skillId: 'F11', masteryScore: 0.81, status: 'mastered' },
      { skillId: 'F14', masteryScore: 0.78, status: 'learning' },
      { skillId: 'R02', masteryScore: 0.34, status: 'needs_support' },
      { skillId: 'E01', masteryScore: 0.46, status: 'learning' }
    ],
    groundTruthRootGapSkillId: 'R02'
  },
  {
    id: 'student-003',
    name: 'Nam',
    classId: 'class-7a',
    grade: 7,
    persona: 'Đã thành thạo các kỹ năng nền, lỗi sai hiện tại chủ yếu do bất cẩn.',
    currentLesson: { skillId: 'E01', questionId: 'Q_E01_001' },
    mastery: [
      { skillId: 'F08', masteryScore: 0.92, status: 'mastered' },
      { skillId: 'F11', masteryScore: 0.9, status: 'mastered' },
      { skillId: 'F14', masteryScore: 0.88, status: 'mastered' },
      { skillId: 'R02', masteryScore: 0.86, status: 'mastered' },
      { skillId: 'E01', masteryScore: 0.8, status: 'mastered' }
    ],
    groundTruthRootGapSkillId: null
  }
]

export const demoLearningPaths: LearningPath[] = [
  {
    id: 'lp-001',
    targetSkillId: 'E01',
    rootGapSkillId: 'F11',
    status: 'not_started',
    estimatedMinutes: 8,
      steps: [
        { id: 'step-1', order: 1, type: 'micro_explanation', skillId: 'F11', contentId: 'EXP_F11_BASIC' },
        { id: 'step-2', order: 2, type: 'worked_example', skillId: 'F11', contentId: 'EXP_F11_BASIC' },
        { id: 'step-3', order: 3, type: 'practice', skillId: 'F11', questionIds: ['P_F11_001'] },
        { id: 'step-4', order: 4, type: 'checkpoint', skillId: 'F11', questionIds: ['CP_F11_001'] },
        { id: 'step-5', order: 5, type: 'return_to_target', skillId: 'E01', questionIds: ['Q_E01_RETRY_001'] }
      ]
  }
]

export function getQuestionById(id: string): Question | undefined {
  return learningPackage.questions.find(q => q.id === id)
}

export function getExplanationById(id: string): Explanation | undefined {
  return learningPackage.explanations.find(e => e.id === id)
}

export function getSkillById(id: string): Skill | undefined {
  return learningPackage.skills.find(s => s.id === id)
}
