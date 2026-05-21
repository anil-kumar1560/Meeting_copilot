"""
llm.py

GPT-4o powered meeting intelligence functions.

Provides:
- generate_insights()        — structured meeting analysis (questions, key points, action items)
- generate_debrief_response() — streaming chat for post-meeting Q&A
- generate_context_preview()  — short plain-text synthesis of current topic
"""

from __future__ import annotations

import asyncio
import json
from typing import AsyncGenerator, Literal

from openai import AsyncOpenAI
from pydantic import BaseModel

# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------


class SuggestedQuestion(BaseModel):
    question: str
    context: str
    type: Literal["clarifying", "bridging", "pressure"]


class MeetingInsights(BaseModel):
    suggested_questions: list[SuggestedQuestion]  # exactly 3
    key_points: list[str]
    action_items: list[str]


# ---------------------------------------------------------------------------
# Module-level client (reads OPENAI_API_KEY from env)
# ---------------------------------------------------------------------------

_client = AsyncOpenAI()
_MODEL = "gpt-4o"

# ---------------------------------------------------------------------------
# Public functions
# ---------------------------------------------------------------------------


async def generate_insights(
    transcript_tail: str,
    rag_context: str,
    topic_tags: list[str],
    user_role: str = "participant",
) -> MeetingInsights:
    """
    Analyse the recent transcript and return structured meeting insights.

    Args:
        transcript_tail: Last ~800 words of the meeting transcript.
        rag_context:     Relevant chunks retrieved from the knowledge base.
        topic_tags:      Active topic tags for this meeting.
        user_role:       The role of the user (e.g. "participant", "host", "observer").

    Returns:
        MeetingInsights with 3 suggested questions, key points, and action items.
    """
    tags_str = ", ".join(topic_tags) if topic_tags else "none"
    rag_section = rag_context.strip() if rag_context.strip() else "No knowledge-base context available."

    system_prompt = f"""You are an AI meeting co-pilot assisting a {user_role}.

Active topic tags: {tags_str}

Knowledge base context:
{rag_section}

Your job is to analyse the recent meeting transcript provided by the user and return structured insights.

Rules:
1. Generate EXACTLY 3 suggested questions the user could ask RIGHT NOW during the meeting.
   - Each question must have a type: "clarifying" (seeks to understand), "bridging" (connects topics), or "pressure" (challenges assumptions).
   - The "context" field should be a short sentence explaining WHY this question is useful.
2. Extract 3–7 key discussion points as concise bullet strings (no leading bullet character).
3. Extract any action items mentioned (tasks, owners, deadlines). If none are explicit, return an empty list.
4. Respond ONLY with a JSON object matching this exact structure — no commentary outside JSON:
{{
  "suggested_questions": [
    {{"question": "...", "context": "...", "type": "clarifying"}},
    {{"question": "...", "context": "...", "type": "bridging"}},
    {{"question": "...", "context": "...", "type": "pressure"}}
  ],
  "key_points": ["point 1", "point 2"],
  "action_items": ["action 1"]
}}"""

    user_message = f"Recent transcript (last ~800 words):\n\n{transcript_tail}"

    response = await _client.chat.completions.create(
        model=_MODEL,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ],
        response_format={"type": "json_object"},
        temperature=0.4,
    )

    raw = response.choices[0].message.content or "{}"
    data = json.loads(raw)
    return MeetingInsights(**data)


async def generate_debrief_response(
    question: str,
    full_transcript: str,
    rag_context: str,
    message_history: list[dict],
) -> AsyncGenerator[str, None]:
    """
    Stream a debrief chat response token by token.

    Args:
        question:        The user's current question.
        full_transcript: Complete meeting transcript text.
        rag_context:     Relevant knowledge-base context.
        message_history: Prior conversation turns [{"role": ..., "content": ...}].

    Yields:
        String tokens as they arrive from the API.
    """
    rag_section = rag_context.strip() if rag_context.strip() else "No knowledge-base context available."
    transcript_section = full_transcript.strip() if full_transcript.strip() else "No transcript available."

    system_prompt = f"""You are a helpful AI assistant helping a user debrief after a meeting.

You have access to:
1. The full meeting transcript.
2. A knowledge base with background materials.

Use both sources to answer the user's questions accurately and concisely.
If the answer is not in the transcript or knowledge base, say so honestly.

--- MEETING TRANSCRIPT ---
{transcript_section}

--- KNOWLEDGE BASE CONTEXT ---
{rag_section}
--- END CONTEXT ---"""

    messages: list[dict] = [{"role": "system", "content": system_prompt}]
    messages.extend(message_history)
    messages.append({"role": "user", "content": question})

    async def _stream() -> AsyncGenerator[str, None]:
        stream = await _client.chat.completions.create(
            model=_MODEL,
            messages=messages,
            temperature=0.5,
            stream=True,
        )
        async for chunk in stream:
            delta = chunk.choices[0].delta
            if delta.content:
                yield delta.content

    return _stream()


async def generate_context_preview(
    recent_transcript: str,
    rag_context: str,
) -> str:
    """
    Produce a short 2-sentence synthesis of what the agent knows about the
    current topic being discussed.

    Args:
        recent_transcript: The most recent portion of the meeting transcript.
        rag_context:       Knowledge-base context retrieved for the current topic.

    Returns:
        A plain string of up to 2 sentences.
    """
    rag_section = rag_context.strip() if rag_context.strip() else "No additional context available."

    system_prompt = (
        "You are an AI meeting assistant. Based on the current meeting discussion and any "
        "available background knowledge, write EXACTLY 2 concise sentences summarising what "
        "is currently being discussed and what relevant background information exists. "
        "Do not use bullet points or headers — plain prose only."
    )

    user_message = (
        f"Recent transcript excerpt:\n{recent_transcript}\n\n"
        f"Knowledge base context:\n{rag_section}"
    )

    response = await _client.chat.completions.create(
        model=_MODEL,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ],
        temperature=0.3,
        max_tokens=120,
    )

    return response.choices[0].message.content or ""
