"""
main.py

FastAPI application for the real-time AI meeting co-pilot.

Start the server:
    uvicorn main:app --reload --host 0.0.0.0 --port 8000
"""

from __future__ import annotations

import asyncio
import datetime
import json
import os
import pathlib
import tempfile
import time
from typing import Any

import aiofiles
from dotenv import load_dotenv
from fastapi import (
    FastAPI,
    File,
    HTTPException,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel

load_dotenv(override=True)

_DEEPGRAM_API_KEY = os.getenv("DEEPGRAM_API_KEY", "")

# Local modules — imported after load_dotenv so env vars are available
from document_parser import parse_document  # noqa: E402
from llm import (  # noqa: E402
    generate_context_preview,
    generate_debrief_response,
    generate_insights,
)
from rag import delete_document, get_document_list, ingest_document, retrieve_context  # noqa: E402
from stt import create_stt  # noqa: E402

# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------

app = FastAPI(title="Meeting Co-Pilot", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def _startup():
    from deepgram import DeepgramClient
    try:
        DeepgramClient(api_key=_DEEPGRAM_API_KEY)
        if _DEEPGRAM_API_KEY:
            print("[Deepgram] API key present, client initialized")
        else:
            print("[Deepgram] WARNING: DEEPGRAM_API_KEY is not set")
    except Exception as exc:
        print(f"[Deepgram] WARNING: {exc}")

# ---------------------------------------------------------------------------
# Meetings persistence
# ---------------------------------------------------------------------------

MEETINGS_DIR = pathlib.Path("./meetings")
MEETINGS_DIR.mkdir(exist_ok=True)

# ---------------------------------------------------------------------------
# In-memory meeting state
# ---------------------------------------------------------------------------

transcript_buffer: list[dict[str, Any]] = []
key_points: list[str] = []
action_items: list[str] = []
suggested_questions: list[dict] = []
active_topic_tags: list[str] = []
user_role: str = "participant"
meeting_active: bool = False
last_llm_refresh: float = 0.0
meeting_start_time: float = 0.0
current_meeting_id: str = ""

LLM_REFRESH_INTERVAL = 20.0  # seconds between automatic LLM refreshes

# ---------------------------------------------------------------------------
# WebSocket connection manager
# ---------------------------------------------------------------------------


class ConnectionManager:
    """Manages a set of active WebSocket connections and provides broadcasting."""

    def __init__(self) -> None:
        self.active_connections: set[WebSocket] = set()

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self.active_connections.add(websocket)

    def disconnect(self, websocket: WebSocket) -> None:
        self.active_connections.discard(websocket)

    async def broadcast(self, message: dict) -> None:
        """Send *message* as JSON to all connected clients, silently dropping dead ones."""
        payload = json.dumps(message)
        dead: set[WebSocket] = set()
        for ws in self.active_connections:
            try:
                await ws.send_text(payload)
            except Exception:
                dead.add(ws)
        for ws in dead:
            self.active_connections.discard(ws)

    async def send_personal(self, websocket: WebSocket, message: dict) -> None:
        try:
            await websocket.send_text(json.dumps(message))
        except Exception:
            self.active_connections.discard(websocket)


manager = ConnectionManager()

# ---------------------------------------------------------------------------
# LLM refresh logic
# ---------------------------------------------------------------------------


def _transcript_tail(n_words: int = 800) -> str:
    """Return the last *n_words* words of the transcript as a single string."""
    words_needed = n_words
    parts: list[str] = []
    for entry in reversed(transcript_buffer):
        words = entry["text"].split()
        parts.extend(reversed(words))
        if len(parts) >= words_needed:
            break
    words_out = list(reversed(parts))[-words_needed:]
    return " ".join(words_out)


def _transcript_tail_short(n_words: int = 200) -> str:
    return _transcript_tail(n_words)


async def _run_llm_refresh() -> None:
    """
    Retrieve context and generate insights, then broadcast the results to all
    connected clients.  Errors are caught so the caller is never crashed.
    """
    global key_points, action_items, suggested_questions, last_llm_refresh

    last_llm_refresh = time.time()

    try:
        tail = _transcript_tail(800)
        short_tail = _transcript_tail_short(200)

        rag_context = await retrieve_context(short_tail, active_topic_tags, n_results=4)

        insights = await generate_insights(
            transcript_tail=tail,
            rag_context=rag_context,
            topic_tags=active_topic_tags,
            user_role=user_role,
        )

        key_points = insights.key_points
        action_items = insights.action_items
        suggested_questions = [q.model_dump() for q in insights.suggested_questions]

        await manager.broadcast(
            {
                "type": "insights",
                "suggested_questions": suggested_questions,
                "key_points": key_points,
                "action_items": action_items,
            }
        )
    except Exception as exc:
        print(f"[LLM refresh] Error: {exc}")
        await manager.broadcast(
            {"type": "error", "message": f"LLM refresh failed: {str(exc)}"}
        )


# ---------------------------------------------------------------------------
# STT callback
# ---------------------------------------------------------------------------


async def _on_transcript(text: str, speaker: str, is_final: bool) -> None:
    """Invoked by the STT backend for every transcript segment (interim and final)."""
    global last_llm_refresh, meeting_start_time

    if not is_final:
        # Broadcast interim result as a ghost line — not stored in buffer
        await manager.broadcast(
            {"type": "transcript_interim", "speaker": speaker, "text": text}
        )
        return

    # First final transcript — record meeting start time
    if not meeting_start_time:
        meeting_start_time = time.time()

    entry: dict[str, Any] = {
        "speaker": speaker,
        "text": text,
        "timestamp": time.time(),
    }
    transcript_buffer.append(entry)

    await manager.broadcast(
        {
            "type": "transcript",
            "speaker": speaker,
            "text": text,
            "timestamp": entry["timestamp"],
        }
    )

    now = time.time()
    if now - last_llm_refresh >= LLM_REFRESH_INTERVAL and len(transcript_buffer) > 0:
        asyncio.create_task(_run_llm_refresh())


# ---------------------------------------------------------------------------
# WebSocket endpoint
# ---------------------------------------------------------------------------


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    global meeting_active, active_topic_tags, user_role

    global current_meeting_id, meeting_start_time

    await manager.connect(websocket)

    # Start a fresh meeting session if this is the first connection
    if not meeting_active:
        current_meeting_id = f"meeting_{int(time.time())}"
        meeting_start_time = 0.0

    meeting_active = True

    stt = create_stt(_on_transcript)
    paused = False

    # Start STT — on failure send one clear error and close immediately so
    # the frontend does not keep reconnecting.
    try:
        await stt.start()
    except Exception as stt_exc:
        print(f"[STT] Failed to start: {stt_exc}")
        try:
            await websocket.send_text(json.dumps({
                "type": "error",
                "message": "Failed to connect to Deepgram. Check your API key.",
            }))
        except Exception:
            pass
        manager.disconnect(websocket)
        if not manager.active_connections:
            meeting_active = False
        return

    try:
        # Send current state to the newly connected client
        await manager.send_personal(
            websocket,
            {
                "type": "connected",
                "transcript": transcript_buffer,
                "key_points": key_points,
                "action_items": action_items,
                "suggested_questions": suggested_questions,
                "active_topic_tags": active_topic_tags,
                "user_role": user_role,
            },
        )

        while True:
            # Receive either binary (audio) or text (control) messages
            try:
                message = await asyncio.wait_for(websocket.receive(), timeout=30.0)
            except asyncio.TimeoutError:
                # Send a ping to keep the connection alive
                try:
                    await websocket.send_text(json.dumps({"type": "ping"}))
                except Exception:
                    break
                continue

            if message["type"] == "websocket.disconnect":
                break

            if message.get("bytes") is not None:
                # Binary audio data — forward to STT
                if not paused:
                    await stt.send_audio(message["bytes"])

            elif message.get("text") is not None:
                # JSON control message
                try:
                    data = json.loads(message["text"])
                except json.JSONDecodeError:
                    await manager.send_personal(
                        websocket,
                        {"type": "error", "message": "Invalid JSON control message"},
                    )
                    continue

                msg_type = data.get("type", "")

                if msg_type == "set_tags":
                    active_topic_tags = data.get("tags", [])
                    await manager.send_personal(
                        websocket,
                        {"type": "ack", "action": "set_tags", "tags": active_topic_tags},
                    )

                elif msg_type == "set_role":
                    user_role = data.get("role", "participant")
                    await manager.send_personal(
                        websocket,
                        {"type": "ack", "action": "set_role", "role": user_role},
                    )

                elif msg_type == "pause":
                    paused = True
                    await manager.send_personal(
                        websocket, {"type": "ack", "action": "pause"}
                    )

                elif msg_type == "resume":
                    paused = False
                    await manager.send_personal(
                        websocket, {"type": "ack", "action": "resume"}
                    )

                elif msg_type == "refresh_suggestions":
                    asyncio.create_task(_run_llm_refresh())
                    await manager.send_personal(
                        websocket,
                        {"type": "ack", "action": "refresh_suggestions"},
                    )

                else:
                    await manager.send_personal(
                        websocket,
                        {"type": "error", "message": f"Unknown message type: {msg_type}"},
                    )

    except WebSocketDisconnect:
        pass
    except Exception as exc:
        print(f"[WebSocket] Unexpected error: {exc}")
        try:
            await manager.send_personal(
                websocket,
                {"type": "error", "message": f"Server error: {str(exc)}"},
            )
        except Exception:
            pass
    finally:
        manager.disconnect(websocket)
        try:
            await stt.stop()
        except Exception as exc:
            print(f"[WebSocket] Error stopping STT: {exc}")
        if not manager.active_connections:
            meeting_active = False


# ---------------------------------------------------------------------------
# Meeting persistence helpers
# ---------------------------------------------------------------------------


def _save_meeting() -> str:
    """Persist the current meeting state to ./meetings/{id}.json. Returns the ID."""
    if not transcript_buffer:
        return ""

    duration_secs = int(time.time() - meeting_start_time) if meeting_start_time else 0
    duration_str = f"{duration_secs // 60:02d}:{duration_secs % 60:02d}"
    meeting_id = current_meeting_id or f"meeting_{int(time.time())}"

    data: dict[str, Any] = {
        "id": meeting_id,
        "date": datetime.datetime.fromtimestamp(
            meeting_start_time or time.time()
        ).isoformat(),
        "duration": duration_str,
        "transcript": [
            {
                "speaker": e["speaker"],
                "text": e["text"],
                "time": datetime.datetime.fromtimestamp(e["timestamp"]).strftime(
                    "%H:%M"
                ),
            }
            for e in transcript_buffer
        ],
        "key_points": list(key_points),
        "action_items": list(action_items),
        "suggested_questions": [
            q.get("question", "") if isinstance(q, dict) else str(q)
            for q in suggested_questions
        ],
    }

    path = MEETINGS_DIR / f"{meeting_id}.json"
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    return meeting_id


# ---------------------------------------------------------------------------
# REST endpoints
# ---------------------------------------------------------------------------


@app.post("/upload")
async def upload_document(file: UploadFile = File(...)):
    """
    Upload a document (PDF, DOCX, or TXT), parse it, and ingest it into the
    ChromaDB knowledge base.
    """
    allowed_extensions = {".pdf", ".docx", ".txt"}
    filename = file.filename or "upload"
    ext = os.path.splitext(filename)[1].lower()

    if ext not in allowed_extensions:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{ext}'. Allowed: {', '.join(allowed_extensions)}",
        )

    # Save to a temp file
    try:
        suffix = ext
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp_path = tmp.name
            content = await file.read()
            tmp.write(content)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to save file: {exc}")

    try:
        text = parse_document(tmp_path, filename)
    except ValueError as exc:
        os.unlink(tmp_path)
        raise HTTPException(status_code=400, detail=str(exc))
    except RuntimeError as exc:
        os.unlink(tmp_path)
        raise HTTPException(status_code=422, detail=str(exc))
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass

    if not text.strip():
        raise HTTPException(
            status_code=422, detail="Document appears to be empty or unreadable."
        )

    chunks = ingest_document(text, filename, active_topic_tags)
    return {"filename": filename, "chunks": chunks}


@app.get("/documents")
async def list_documents():
    """Return all documents currently stored in the knowledge base."""
    docs = get_document_list()
    return {"documents": docs}


@app.delete("/documents/{filename:path}")
async def remove_document(filename: str):
    """Delete all chunks for the specified document from ChromaDB."""
    deleted = delete_document(filename)
    if not deleted:
        raise HTTPException(
            status_code=404, detail=f"Document '{filename}' not found in knowledge base."
        )
    return {"deleted": True, "filename": filename}


@app.get("/transcript")
async def get_transcript():
    """Return the full in-memory transcript buffer."""
    return {"transcript": transcript_buffer, "length": len(transcript_buffer)}


class DebriefRequest(BaseModel):
    question: str
    history: list[dict] = []


@app.post("/debrief/chat")
async def debrief_chat(request: DebriefRequest):
    """
    Stream a debrief chat response.  The client receives server-sent event
    style chunked text.
    """
    full_transcript = "\n".join(
        f"{e['speaker']}: {e['text']}" for e in transcript_buffer
    )
    rag_context = await retrieve_context(request.question, active_topic_tags, n_results=5)

    # Validate history structure
    history: list[dict] = []
    for entry in request.history:
        if isinstance(entry, dict) and "role" in entry and "content" in entry:
            if entry["role"] in ("user", "assistant"):
                history.append({"role": entry["role"], "content": str(entry["content"])})

    gen = await generate_debrief_response(
        question=request.question,
        full_transcript=full_transcript,
        rag_context=rag_context,
        message_history=history,
    )

    async def _streamer():
        try:
            async for token in gen:
                yield token
        except Exception as exc:
            yield f"\n[Error: {exc}]"

    return StreamingResponse(_streamer(), media_type="text/plain")


@app.get("/status")
async def get_status():
    """Return the current meeting status."""
    return {
        "meeting_active": meeting_active,
        "transcript_length": len(transcript_buffer),
        "last_refresh": last_llm_refresh,
        "active_topic_tags": active_topic_tags,
        "user_role": user_role,
        "connected_clients": len(manager.active_connections),
    }


@app.post("/reset")
async def reset_meeting():
    """Clear the transcript and all derived meeting data."""
    global transcript_buffer, key_points, action_items, suggested_questions, last_llm_refresh, meeting_start_time

    transcript_buffer.clear()
    key_points.clear()
    action_items.clear()
    suggested_questions.clear()
    last_llm_refresh = 0.0
    meeting_start_time = 0.0

    await manager.broadcast({"type": "reset"})

    return {"reset": True}


@app.post("/meetings/save")
async def save_meeting():
    """Save the current meeting to disk and return its ID."""
    meeting_id = _save_meeting()
    if not meeting_id:
        raise HTTPException(status_code=400, detail="No transcript to save.")
    return {"id": meeting_id, "saved": True}


@app.get("/meetings")
async def list_meetings():
    """Return a list of all saved meetings (newest first)."""
    meetings = []
    for path in sorted(MEETINGS_DIR.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            meetings.append(
                {
                    "id": data.get("id", path.stem),
                    "date": data.get("date", ""),
                    "duration": data.get("duration", ""),
                    "transcript_count": len(data.get("transcript", [])),
                }
            )
        except Exception:
            continue
    return {"meetings": meetings}


@app.get("/meetings/{meeting_id}")
async def get_meeting(meeting_id: str):
    """Return the full saved meeting data."""
    path = MEETINGS_DIR / f"{meeting_id}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Meeting not found.")
    return json.loads(path.read_text(encoding="utf-8"))


@app.get("/meetings/{meeting_id}/download")
async def download_meeting(meeting_id: str):
    """Return a formatted .txt transcript file for download."""
    path = MEETINGS_DIR / f"{meeting_id}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Meeting not found.")

    data = json.loads(path.read_text(encoding="utf-8"))

    lines: list[str] = [
        f"MEETING TRANSCRIPT",
        f"Date: {data.get('date', '')}",
        f"Duration: {data.get('duration', '')}",
        "",
        "─" * 60,
        "",
    ]
    for entry in data.get("transcript", []):
        lines.append(f"[{entry['speaker']} - {entry['time']}] {entry['text']}")

    if data.get("key_points"):
        lines += ["", "─" * 60, "", "KEY POINTS:"]
        for kp in data["key_points"]:
            lines.append(f"  - {kp}")

    if data.get("action_items"):
        lines += ["", "ACTION ITEMS:"]
        for ai in data["action_items"]:
            lines.append(f"  - {ai}")

    content = "\n".join(lines)
    return Response(
        content=content.encode("utf-8"),
        media_type="text/plain; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{meeting_id}.txt"'
        },
    )


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------


@app.get("/health")
async def health_check():
    return {"status": "ok", "service": "meeting-co-pilot"}
