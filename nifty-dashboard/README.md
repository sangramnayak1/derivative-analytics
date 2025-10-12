# Nifty Dashboard (backend + frontend)

This repository contains a minimal modular **backend** (Flask) and **frontend** (React/Vite)
scaffold for the NIFTY OI / PCR dashboard. The project is structured to run with Docker Compose.

## Contents
- `backend/` - Python backend (Flask) in `src/backend/`
- `frontend/` - React frontend (Vite)
- `docker-compose.yml` - service definitions for backend and frontend
- `data/` - (created at runtime) stores snapshots and candles

## Quick start (with Docker)
1. Ensure Docker & Docker Compose are installed on your machine.
2. From the project root (where `docker-compose.yml` is located) run:
   ```bash
   docker compose build
   docker compose up -d
   ```
3. Access APIs.
   - Open the frontend in your browser: http://localhost:5173
   - Backend API: http://localhost:8000/api/nifty/optionchain
   - Window stats: http://localhost:8000/api/nifty/window_stats?mode=FIXED
4. Code change and build.
   ```
   docker compose build --no-cache frontend
   docker compose build --no-cache backend
   docker compose up -d --build frontend
   ```
5. Debug and log check.
   ```
   docker compose logs --tail=200 frontend
   docker compose logs --tail=200 backend
   curl -s http://localhost:8000/api/nifty/window_stats | jq .[0]
   ```

## Run without Docker (dev)
### Backend
```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cd src
python -m backend.app_api
```
The backend will listen on port 8000.

### Frontend
```bash
cd frontend
npm install
npm run dev
```

## Notes & Caveats
- The backend uses the NSE public option-chain endpoint. NSE occasionally blocks automated requests. For production use, configure a broker API (Firstock/Upstox/Dhan) and update `backend/src/backend/fetcher.py` accordingly.
- This repository is a scaffold. The frontend is a minimal React app that demonstrates fetching the window stats and sample rows. You can replace `src/App.jsx` with the full React components provided earlier.
- Data snapshots are appended to `backend/data/snapshots.jsonl` and candles are written to `backend/data/candles_1m.json`.

## Next steps
- Replace the sample UI with the full React components (OI heatmap, strike table with heat shading, CanvasJS candlestick) as required.
- Add broker API support and API key configuration if you need reliable production data.

