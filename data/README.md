# MVP Data Package

Data này bám theo `API.txt`, `Checkpoint1.docx` và sơ đồ `mermaid-diagram.png`.

## File chính

- `learning-package.math-fractions-v1.json`: file tổng hợp cho `GET /api/v1/learning-packages/math-fractions-v1`.
- `skills.json`: danh sách skill trong knowledge graph.
- `edges.json`: quan hệ phụ thuộc kiến thức, dựa trên sơ đồ mermaid.
- `questions.json`: question bank đã có đáp án, validation và error mappings để chạy offline.
- `diagnosticRules.json`: rule tối thiểu cho diagnostic engine.
- `explanations.json`: giải thích ngắn dùng offline và làm fallback cho AI.
- `workedExamples.json`: ví dụ mẫu cho learning path.
- `learningPaths.json`: lộ trình phục hồi mẫu cho F11 và R02.
- `students.json`: 3 hồ sơ demo Minh, Lan, Nam.
- `classInsights.mock.json`: mock response data cho dashboard giáo viên.
- `aiTemplates.json`: guardrail/template cho AI tạo sinh.
- `demoScenarios.json`: ground truth để test diagnostic engine.

## Chuỗi demo chính

```text
Minh làm sai E01 — Phương trình chứa phân số
→ errorPattern = ADD_DENOMINATORS
→ diagnostic phân biệt F08/F11/F14
→ rootGap = F11 — Quy đồng mẫu số
→ learningPath = lp-001
→ checkpoint CP_F11_001
→ quay lại Q_E01_RETRY_001
```

## Đã double-check

- Mọi `skillId` trong question/rule/path đều tồn tại trong `skills.json`.
- Mọi `questionId` và `contentId` trong `learningPaths.json` đều tồn tại trong learning package.
- `ADD_DENOMINATORS` thống nhất giữa `questions.json`, `diagnosticRules.json` và `API.txt`.
- `F02` đến `F17` bám theo sơ đồ fraction graph; `R02` và `E01` được thêm để nối MVP từ lớp 5 sang lớp 7.
- Data có đủ fallback offline: questions, validation, explanations, diagnostic rules.

