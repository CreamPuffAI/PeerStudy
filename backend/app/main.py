from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List

app = FastAPI(
    title="PeerStudy API",
    description="Backend for the adaptive tutor with offline sync and exercise generation.",
    version="0.1.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:4173"],
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"]
)

class Exercise(BaseModel):
    student_id: str
    topic: str
    level: str
    count: int

class StudentProgress(BaseModel):
    student_id: str
    topic: str
    score: float
    attempts: int

class SyncPayload(BaseModel):
    student_id: str
    offline_changes: List[dict]

@app.get("/health")
async def health():
    return {"status": "ok"}

@app.post("/generate-exercises")
async def generate_exercises(request: Exercise):
    return {
        "student_id": request.student_id,
        "topic": request.topic,
        "level": request.level,
        "exercises": [
            {"id": f"{request.topic}-1", "question": "Giải phương trình 2x + 3 = 11", "answer": "4"},
            {"id": f"{request.topic}-2", "question": "Tìm x: 5x - 7 = 18", "answer": "5"}
        ]
    }

@app.post("/sync-progress")
async def sync_progress(payload: SyncPayload):
    return {"synced": len(payload.offline_changes), "status": "ok"}

@app.post("/student-progress")
async def student_progress(progress: StudentProgress):
    return {"received": progress.dict()}
