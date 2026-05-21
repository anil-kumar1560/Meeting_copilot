"""
stt.py

Speech-to-text integrations:
  - DeepgramSTT  — real-time streaming via Deepgram Nova-2 (async WebSocket)
  - MockSTT      — deterministic fake transcript for local development
                   (activated when MOCK_STT=true in the environment)
"""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Callable, Awaitable

# verboselogs adds notice/verbose/spam methods that the Deepgram SDK expects.
import verboselogs
verboselogs.install()

# Suppress Deepgram SDK loggers to avoid spam on every instantiation.
for _name in (
    "deepgram",
    "deepgram.clients.live.v1.async_client",
    "deepgram.clients.live.v1.client",
    "deepgram.clients.live",
):
    _lg = logging.getLogger(_name)
    _lg.setLevel(logging.CRITICAL + 1)
    _lg.handlers.clear()
    _lg.propagate = False

from deepgram import (
    DeepgramClient,
    LiveTranscriptionEvents,
    LiveOptions,
)

# ---------------------------------------------------------------------------
# Type alias
# ---------------------------------------------------------------------------

TranscriptCallback = Callable[[str, str, bool], Awaitable[None]]
# (text: str, speaker: str, is_final: bool) -> None

# ---------------------------------------------------------------------------
# DeepgramSTT
# ---------------------------------------------------------------------------


class DeepgramSTT:
    """
    Live streaming speech-to-text using the Deepgram Nova-2 model.

    Uses AsyncLiveClient so it runs entirely within the asyncio event loop —
    no background threads, no run_coroutine_threadsafe needed.

    Usage:
        async def on_transcript(text, speaker, is_final):
            print(speaker, text)

        stt = DeepgramSTT(on_transcript)
        await stt.start()
        await stt.send_audio(audio_bytes)
        await stt.stop()
    """

    def __init__(self, on_transcript_callback: TranscriptCallback) -> None:
        self.api_key: str = os.getenv("DEEPGRAM_API_KEY", "")
        self.on_transcript: TranscriptCallback = on_transcript_callback
        self.connection = None
        self.client: DeepgramClient | None = None
        self._running = False

    async def start(self) -> None:
        """Initialise the Deepgram async client and open a live transcription connection."""
        self.client = DeepgramClient(self.api_key)

        options = LiveOptions(
            model="nova-2",
            language="en-US",
            smart_format=True,
            interim_results=True,
            punctuate=True,
            diarize=True,
            endpointing=400,
            utterance_end_ms="1000",
        )

        # AsyncLiveClient — uses asyncio websockets, works inside FastAPI's event loop.
        self.connection = self.client.listen.asynclive.v("1")

        # Capture self for closure
        stt_ref = self

        async def _on_message(self_inner, result, **kwargs):
            """Handle transcript events — called as an asyncio task by the SDK."""
            try:
                channel = result.channel
                alternatives = channel.alternatives
                if not alternatives:
                    return

                transcript_text: str = alternatives[0].transcript
                if not transcript_text.strip():
                    return

                is_final: bool = result.is_final

                speaker = "Speaker 0"
                words = getattr(alternatives[0], "words", None)
                if words:
                    first_word_speaker = getattr(words[0], "speaker", None)
                    if first_word_speaker is not None:
                        speaker = f"Speaker {first_word_speaker}"

                await stt_ref.on_transcript(transcript_text, speaker, is_final)
            except Exception as exc:
                print(f"[DeepgramSTT] Error in on_message handler: {exc}")

        async def _on_error(self_inner, error, **kwargs):
            print(f"[DeepgramSTT] Error: {error}")

        async def _on_close(self_inner, close, **kwargs):
            print("[DeepgramSTT] Connection closed")

        self.connection.on(LiveTranscriptionEvents.Transcript, _on_message)
        self.connection.on(LiveTranscriptionEvents.Error, _on_error)
        self.connection.on(LiveTranscriptionEvents.Close, _on_close)

        started = await self.connection.start(options)
        if not started:
            raise RuntimeError("Failed to start Deepgram live connection")
        self._running = True

    async def send_audio(self, audio_chunk: bytes) -> None:
        """Forward a raw audio chunk to the open Deepgram connection."""
        if self.connection and self._running:
            try:
                await self.connection.send(audio_chunk)
            except Exception as exc:
                print(f"[DeepgramSTT] Failed to send audio chunk: {exc}")

    async def stop(self) -> None:
        """Gracefully close the Deepgram connection."""
        self._running = False
        if self.connection:
            try:
                await self.connection.finish()
            except Exception as exc:
                print(f"[DeepgramSTT] Error closing connection: {exc}")
            finally:
                self.connection = None


# ---------------------------------------------------------------------------
# MockSTT
# ---------------------------------------------------------------------------

_MOCK_TRANSCRIPT: list[tuple[str, str]] = [
    ("Speaker A", "Good morning everyone, thanks for joining today's product sync."),
    ("Speaker B", "Morning! Happy to be here. Should we start with the roadmap review?"),
    ("Speaker A", "Yes, let's do that. We have three major features planned for Q3."),
    ("Speaker B", "Right. The first is the new dashboard redesign. Design handoffs are done."),
    ("Speaker A", "Great. Who is owning the implementation on the engineering side?"),
    ("Speaker B", "Sarah is leading that. She estimates two sprints, so about four weeks."),
    ("Speaker A", "That tracks. The second item is the notification system overhaul."),
    ("Speaker B", "That one is more complex. We still have open questions on the delivery mechanism."),
    ("Speaker A", "Push notifications, email, or both? I think we should support both by default."),
    ("Speaker B", "Agreed. Mark said he would have a technical spec ready by end of week."),
    ("Speaker A", "Good. Please make sure Mark sends that to the whole team, not just engineering."),
    ("Speaker B", "Will do. The third item is the API rate-limiting improvements for enterprise clients."),
    ("Speaker A", "That is blocking two of our biggest accounts. It needs to be prioritised."),
    ("Speaker B", "Absolutely. Can we pull it into this sprint instead of next?"),
    ("Speaker A", "Let me check with the team after this call. I will send a Slack message today."),
    ("Speaker B", "Perfect. One more thing — the Q2 retrospective notes still need to be shared."),
    ("Speaker A", "Right, I will circulate those after lunch. Any other blockers before we wrap?"),
    ("Speaker B", "Nothing critical from my side. The staging environment was slow yesterday."),
    ("Speaker A", "DevOps is aware. They are upgrading the instance type this afternoon."),
    ("Speaker B", "Excellent. Thanks everyone, let us reconvene next Tuesday at the same time."),
]


class MockSTT:
    """
    Deterministic fake STT for local development.

    Replays _MOCK_TRANSCRIPT line by line, one entry every 3 seconds.
    Set MOCK_STT=true in the environment to enable this instead of Deepgram.
    """

    def __init__(self, on_transcript_callback: TranscriptCallback) -> None:
        self.on_transcript: TranscriptCallback = on_transcript_callback
        self._task: asyncio.Task | None = None
        self._running = False

    async def start(self) -> None:
        """Begin replaying the mock transcript asynchronously."""
        self._running = True
        self._task = asyncio.create_task(self._replay())

    async def _replay(self) -> None:
        for speaker, text in _MOCK_TRANSCRIPT:
            if not self._running:
                break
            try:
                await self.on_transcript(text, speaker, True)
            except Exception as exc:
                print(f"[MockSTT] Callback error: {exc}")
            await asyncio.sleep(3)

    async def send_audio(self, audio_chunk: bytes) -> None:
        """No-op for mock mode — audio is ignored."""
        pass

    async def stop(self) -> None:
        """Stop the mock replay loop."""
        self._running = False
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------


def create_stt(on_transcript_callback: TranscriptCallback) -> DeepgramSTT | MockSTT:
    """
    Return the appropriate STT backend based on the MOCK_STT environment variable.

    Args:
        on_transcript_callback: async callable(text, speaker) invoked on each final transcript.

    Returns:
        MockSTT if MOCK_STT=true, otherwise DeepgramSTT.
    """
    use_mock = os.getenv("MOCK_STT", "false").strip().lower() == "true"
    if use_mock:
        print("[STT] Using MockSTT (MOCK_STT=true)")
        return MockSTT(on_transcript_callback)
    return DeepgramSTT(on_transcript_callback)
