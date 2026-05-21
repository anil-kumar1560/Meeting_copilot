# Meeting Co-Pilot

A real-time AI meeting co-pilot that listens to your meeting, transcribes speech, and surfaces suggested questions, key points, and action items — all in a split-screen desktop UI you run alongside Zoom or Google Meet.

## Features

- **Live transcript** with speaker labels (diarised via Deepgram)
- **3 suggested questions** refreshed every 20 seconds (clarifying / bridging / pressure types)
- **Key points** extracted automatically as the meeting progresses
- **Action items** detected from conversation
- **Knowledge base** — upload PDFs, DOCX, or TXT files before the meeting; the agent uses them as RAG context
- **Debrief mode** — post-meeting chat interface to query the full transcript
- **Mock mode** — test the UI without a live meeting or API keys

---

## Project Structure

```
meeting-copilot/
  backend/
    main.py             # FastAPI app + WebSocket endpoint
    stt.py              # Deepgram streaming STT + MockSTT
    llm.py              # GPT-4o: suggestions, key points, action items, debrief
    rag.py              # ChromaDB ingestion + retrieval
    document_parser.py  # PDF / DOCX / TXT parsing
    requirements.txt
    .env.example
  frontend/
    app/
      page.tsx           # Main co-pilot UI
      upload/page.tsx    # Knowledge base upload page
    components/
      TranscriptPanel.tsx
      SuggestionsPanel.tsx
      KeyPointsPanel.tsx
      ActionItemsPanel.tsx
      DebriefChat.tsx
      KnowledgeBase.tsx
```

---

## Prerequisites

| Tool | Version |
|------|---------|
| Python | 3.10+ |
| Node.js | 18+ |
| npm | 9+ |

You will need:
- An **OpenAI API key** (for GPT-4o + embeddings)
- A **Deepgram API key** (for live STT) — free tier works

---

## Setup

### 1. Clone / navigate to the project

```bash
cd Meeting_agent
```

### 2. Backend

```bash
cd backend

# Copy and fill in environment variables
cp .env.example .env
# Edit .env and set OPENAI_API_KEY and DEEPGRAM_API_KEY

# Create a virtual environment (recommended)
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Start the server
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Backend runs at **http://localhost:8000**. API docs at **http://localhost:8000/docs**.

### 3. Frontend

```bash
cd frontend

npm install
npm run dev
```

Frontend runs at **http://localhost:3000**.

---

## Environment Variables

Create `backend/.env` from `backend/.env.example`:

```env
OPENAI_API_KEY=sk-...          # Required for LLM + embeddings
DEEPGRAM_API_KEY=...           # Required for live STT
MOCK_STT=false                 # Set to true to use fake transcript (no mic/keys needed)
```

### Mock mode

Set `MOCK_STT=true` to replay a hardcoded 20-line meeting transcript (one line every 3 seconds). This lets you test the full UI — suggestions, key points, action items, debrief — without a live meeting or API keys.

---

## Usage

### Before the meeting

1. Go to **http://localhost:3000/upload**
2. Upload relevant documents (PDF, DOCX, TXT) — product specs, agendas, reports, etc.
3. The agent chunks, embeds, and stores them in ChromaDB locally

### During the meeting

1. Go to **http://localhost:3000**
2. Set your **role** (participant / facilitator / note-taker) in the header dropdown
3. Add **topic tags** (e.g. "Q3 roadmap", "budget") to focus RAG retrieval
4. Click **Start** — the browser will request microphone permission
5. The transcript fills in real time on the left; suggestions / key points / action items update on the right
6. Hit **Pause** to freeze STT without ending the session
7. Click **Refresh** on the suggestions panel to force an immediate AI refresh

### After the meeting

1. Click **Debrief** in the header
2. Ask questions about the meeting — the agent answers using the full transcript + knowledge base

---

## Architecture

```
Browser mic
    │  (binary audio chunks via WebSocket)
    ▼
FastAPI /ws
    │
    ├── DeepgramSTT ──► final transcripts ──► transcript buffer
    │                                              │
    │                                    (every 20s or on demand)
    │                                              │
    └──────────────────────────────────────► LLM refresh
                                                   │
                                     ┌─────────────┴─────────────┐
                                     │                           │
                                 RAG retrieval              GPT-4o call
                                (ChromaDB)              (structured output)
                                     └─────────────┬─────────────┘
                                                   │
                                      broadcast insights via WS
                                                   │
                                              Frontend
                                    (suggestions / key points / actions)
```

### WebSocket message protocol

**Client → Server (binary):** raw audio bytes from MediaRecorder

**Client → Server (JSON):**
```json
{ "type": "set_tags", "tags": ["roadmap", "budget"] }
{ "type": "set_role", "role": "facilitator" }
{ "type": "pause" }
{ "type": "resume" }
{ "type": "refresh_suggestions" }
```

**Server → Client (JSON):**
```json
{ "type": "transcript", "speaker": "Speaker A", "text": "...", "timestamp": 1234567890.0 }
{ "type": "insights", "suggested_questions": [...], "key_points": [...], "action_items": [...] }
{ "type": "reset" }
```

---

## API Reference

| Method | Path | Description |
|--------|------|-------------|
| `WS` | `/ws` | Main WebSocket — audio in, events out |
| `POST` | `/upload` | Upload a document to the knowledge base |
| `GET` | `/documents` | List all knowledge base documents |
| `DELETE` | `/documents/{filename}` | Remove a document |
| `GET` | `/transcript` | Fetch full transcript buffer |
| `POST` | `/debrief/chat` | Streamed debrief Q&A |
| `GET` | `/status` | Meeting state + connected client count |
| `POST` | `/reset` | Clear transcript + insights |
| `GET` | `/health` | Health check |

---

## Troubleshooting

**Microphone not working**
- Make sure the browser has mic permission (look for the camera/mic icon in the address bar)
- Use Chrome or Edge — Firefox MediaRecorder support for WebM/Opus may vary

**"WebSocket connection failed"**
- Confirm the backend is running on port 8000: `curl http://localhost:8000/health`
- Check CORS — the backend allows `http://localhost:3000` by default

**No suggestions appearing**
- Check that `OPENAI_API_KEY` is set and valid
- Open browser DevTools → Network → WS to see raw messages
- Watch backend logs for LLM errors

**Deepgram errors**
- Verify `DEEPGRAM_API_KEY` is valid
- Set `MOCK_STT=true` to bypass Deepgram entirely for UI testing

**ChromaDB errors on startup**
- Delete `./chroma_db` directory and restart — it will be recreated fresh

---

## Development Notes

- Transcript buffer is **in-memory only** — it clears on backend restart
- ChromaDB knowledge base is **persisted to `./chroma_db`** — survives restarts
- LLM refresh is **debounced to max once per 20 seconds** to control API costs
- The suggestions panel shows a "thinking..." skeleton while the LLM call is in flight
- The UI works as a narrow side window — minimum width 400px
