# PeerStudy

## Project Structure

- `frontend/` - React + Vite + Tailwind PWA frontend
  - `src/` - React components and pages
  - `vite.config.ts` - Vite + PWA plugin setup
  - `tailwind.config.js` - Tailwind CSS setup
- `backend/` - FastAPI backend server
  - `app/main.py` - API endpoints for exercise generation and offline sync
  - `pyproject.toml` - Python dependencies

## Technology Notes

### Frontend
- Framework: React.js with Vite
- Styling: Tailwind CSS
- PWA support: `vite-plugin-pwa`
- Offline local storage: Dexie.js (IndexedDB wrapper)
- Dashboard charts: Recharts / Chart.js

### Backend
- Framework: FastAPI
- API docs: Swagger UI auto-generated at `/docs`
- Sync endpoints: `/sync-progress`, `/student-progress`
- Exercise generation endpoint: `/generate-exercises`

## How to run

### Frontend
1. `cd frontend`
2. `npm install`
3. `npm run dev`

### Backend
1. `cd backend`
2. `python -m venv .venv`
3. `source .venv/bin/activate`
4. `pip install -r requirements.txt` or use Poetry
5. `uvicorn app.main:app --reload --port 8000`

## Team Notes

- `frontend/src/App.tsx`: main dashboard shell and offline status badge.
- `frontend/src/components/TutorDashboard.tsx`: teacher analytics charts.
- `frontend/vite.config.ts`: PWA service worker plugin and manifest config.
- `frontend/src/index.css`: Tailwind entry point.
- `backend/app/main.py`: FastAPI endpoints and CORS config.
- `backend/pyproject.toml`: backend dependencies.

### What to build next
- Implement Dexie models in `frontend/src/lib/db.ts` for offline exercise storage.
- Add student practice UI under `frontend/src/components/StudentPractice.tsx`.
- Add teacher dashboard filters and heatmap view.
- Integrate OpenAI / Gemini in `backend/app/main.py` for dynamic exercise generation.
