"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Mic, MicOff, Square, Tag, X, Plus, ChevronDown, FileText } from "lucide-react";
import Link from "next/link";
import TranscriptPanel from "@/components/TranscriptPanel";
import SuggestionsPanel from "@/components/SuggestionsPanel";
import KeyPointsPanel from "@/components/KeyPointsPanel";
import ActionItemsPanel from "@/components/ActionItemsPanel";
import DebriefChat from "@/components/DebriefChat";

export interface TranscriptEntry {
  speaker: string;
  text: string;
  timestamp: number;
  id: string;
}

export interface SuggestedQuestion {
  question: string;
  context: string;
  type: "clarifying" | "bridging" | "pressure";
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function HomePage() {
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [suggestions, setSuggestions] = useState<SuggestedQuestion[]>([]);
  const [keyPoints, setKeyPoints] = useState<string[]>([]);
  const [actionItems, setActionItems] = useState<string[]>([]);
  const [isLive, setIsLive] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [meetingSeconds, setMeetingSeconds] = useState(0);
  const [topicTags, setTopicTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [wsConnected, setWsConnected] = useState(false);
  const [showDebrief, setShowDebrief] = useState(false);
  const [userRole, setUserRole] = useState("participant");
  const [micError, setMicError] = useState("");
  const [interimText, setInterimText] = useState("");
  const [interimSpeaker, setInterimSpeaker] = useState("");
  const [meetingId, setMeetingId] = useState("");
  const [toast, setToast] = useState("");

  const wsRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const toastTimerRef = useRef<NodeJS.Timeout | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(""), 3500);
  }, []);

  // Meeting timer
  useEffect(() => {
    if (isLive && !isPaused) {
      timerRef.current = setInterval(() => {
        setMeetingSeconds((s) => s + 1);
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [isLive, isPaused]);

  const stopMediaRecorder = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    mediaRecorderRef.current = null;
  }, []);

  const startMeeting = useCallback(async () => {
    try {
      setMeetingSeconds(0);
      setTranscript([]);
      setSuggestions([]);
      setKeyPoints([]);
      setActionItems([]);

      const ws = new WebSocket("ws://localhost:8000/ws");
      wsRef.current = ws;

      ws.onopen = async () => {
        setWsConnected(true);
        setIsLive(true);

        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          streamRef.current = stream;

          const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
            ? "audio/webm;codecs=opus"
            : "audio/webm";

          const recorder = new MediaRecorder(stream, { mimeType });
          mediaRecorderRef.current = recorder;

          recorder.ondataavailable = (event) => {
            if (event.data.size > 0 && ws.readyState === WebSocket.OPEN) {
              ws.send(event.data);
            }
          };

          recorder.start(250);
        } catch (micErr) {
          console.error("Microphone access error:", micErr);
          setMicError("Microphone access denied. Please allow mic permission and try again.");
          stopMeeting();
        }
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data as string);

          if (data.type === "transcript") {
            const entry: TranscriptEntry = {
              speaker: data.speaker || "Speaker",
              text: data.text || "",
              timestamp: data.timestamp || Date.now(),
              id: data.id || `${Date.now()}-${Math.random()}`,
            };
            setTranscript((prev) => [...prev, entry]);
            setInterimText("");
            setInterimSpeaker("");
          } else if (data.type === "transcript_interim") {
            setInterimText(data.text || "");
            setInterimSpeaker(data.speaker || "");
          } else if (data.type === "insights") {
            if (data.suggested_questions) setSuggestions(data.suggested_questions);
            if (data.key_points) setKeyPoints(data.key_points);
            if (data.action_items) setActionItems(data.action_items);
            setThinking(false);
          } else if (data.type === "error") {
            setMicError(data.message || "Backend error — check server logs.");
            stopMeeting();
          }
        } catch (parseErr) {
          console.error("WS message parse error:", parseErr);
        }
      };

      ws.onclose = () => {
        setWsConnected(false);
        stopMediaRecorder();
      };

      ws.onerror = (err) => {
        console.error("WebSocket error:", err);
        setWsConnected(false);
        stopMediaRecorder();
      };
    } catch (err) {
      console.error("Failed to start meeting:", err);
    }
  }, [stopMediaRecorder]);

  const stopMeeting = useCallback(async () => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    stopMediaRecorder();
    setIsLive(false);
    setIsPaused(false);
    setWsConnected(false);
    setInterimText("");
    setInterimSpeaker("");
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    // Save meeting to disk
    try {
      const res = await fetch("http://localhost:8000/meetings/save", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setMeetingId(data.id);
        showToast("Meeting saved ✓");
      }
    } catch {
      // backend might not have transcript yet — silently ignore
    }
  }, [stopMediaRecorder, showToast]);

  const togglePause = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    if (isPaused) {
      wsRef.current.send(JSON.stringify({ type: "resume" }));
      setIsPaused(false);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === "paused") {
        mediaRecorderRef.current.resume();
      }
    } else {
      wsRef.current.send(JSON.stringify({ type: "pause" }));
      setIsPaused(true);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
        mediaRecorderRef.current.pause();
      }
    }
  }, [isPaused]);

  const addTag = useCallback(
    (tag: string) => {
      const trimmed = tag.trim();
      if (!trimmed || topicTags.includes(trimmed)) return;
      const newTags = [...topicTags, trimmed];
      setTopicTags(newTags);
      setTagInput("");
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "set_tags", tags: newTags }));
      }
    },
    [topicTags]
  );

  const removeTag = useCallback(
    (tag: string) => {
      const newTags = topicTags.filter((t) => t !== tag);
      setTopicTags(newTags);
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "set_tags", tags: newTags }));
      }
    },
    [topicTags]
  );

  const refreshSuggestions = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    setThinking(true);
    wsRef.current.send(JSON.stringify({ type: "refresh_suggestions" }));
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) wsRef.current.close();
      stopMediaRecorder();
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [stopMediaRecorder]);

  return (
    <div className="flex flex-col h-screen bg-[#0f1117] min-w-[400px]">
      {/* Mic error banner */}
      {micError && (
        <div className="flex items-center gap-2 px-4 py-2 bg-red-900/60 border-b border-red-800 text-red-300 text-xs flex-shrink-0">
          <span>{micError}</span>
          <button onClick={() => setMicError("")} className="ml-auto hover:text-red-100">✕</button>
        </div>
      )}

      {/* Header */}
      <header className="flex items-center h-14 px-4 border-b border-gray-800 gap-4 flex-shrink-0">
        {/* Logo */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <Mic className="w-5 h-5 text-indigo-400" />
          <span className="font-semibold text-gray-100 text-sm whitespace-nowrap">
            Meeting Co-Pilot
          </span>
        </div>

        {/* Center section */}
        <div className="flex items-center gap-3 flex-1 min-w-0">
          {/* Timer */}
          <div className="flex-shrink-0 font-mono text-sm text-gray-300 bg-gray-900 px-2 py-1 rounded border border-gray-800">
            {formatTime(meetingSeconds)}
          </div>

          {/* Live/Paused badge */}
          {isLive && (
            <div
              className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-full flex-shrink-0 ${
                isPaused
                  ? "bg-yellow-900/40 text-yellow-400 border border-yellow-800"
                  : "bg-green-900/40 text-green-400 border border-green-800"
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  isPaused ? "bg-yellow-400" : "bg-green-400 animate-pulse-dot"
                }`}
              />
              {isPaused ? "Paused" : "Live"}
            </div>
          )}

          {/* Topic tags */}
          <div className="flex items-center gap-1.5 flex-wrap min-w-0">
            {topicTags.map((tag) => (
              <span
                key={tag}
                className="flex items-center gap-1 text-xs bg-indigo-900/40 text-indigo-300 border border-indigo-800 px-2 py-0.5 rounded-full"
              >
                <Tag className="w-2.5 h-2.5" />
                {tag}
                <button
                  onClick={() => removeTag(tag)}
                  className="hover:text-indigo-100 ml-0.5"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </span>
            ))}

            {/* Tag input */}
            <div className="flex items-center gap-1">
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addTag(tagInput);
                }}
                placeholder="Add topic..."
                className="text-xs bg-gray-900 border border-gray-700 text-gray-300 placeholder-gray-600 rounded px-2 py-0.5 w-24 focus:outline-none focus:border-indigo-600"
              />
              <button
                onClick={() => addTag(tagInput)}
                className="text-gray-500 hover:text-indigo-400 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Right controls */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Role dropdown */}
          <div className="relative">
            <select
              value={userRole}
              onChange={(e) => setUserRole(e.target.value)}
              className="appearance-none text-xs bg-gray-900 border border-gray-700 text-gray-300 rounded px-2 py-1 pr-6 focus:outline-none focus:border-indigo-600 cursor-pointer"
            >
              <option value="participant">Participant</option>
              <option value="facilitator">Facilitator</option>
              <option value="note-taker">Note-taker</option>
            </select>
            <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-500 pointer-events-none" />
          </div>

          {/* Pause/Resume button (only when live) */}
          {isLive && (
            <button
              onClick={togglePause}
              className={`text-xs px-3 py-1 rounded border transition-colors ${
                isPaused
                  ? "border-green-700 text-green-400 hover:bg-green-900/30"
                  : "border-yellow-700 text-yellow-400 hover:bg-yellow-900/30"
              }`}
            >
              {isPaused ? "Resume" : "Pause"}
            </button>
          )}

          {/* Start/Stop button */}
          {!isLive ? (
            <button
              onClick={startMeeting}
              className="flex items-center gap-1.5 text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded transition-colors"
            >
              <Mic className="w-3.5 h-3.5" />
              Start Meeting
            </button>
          ) : (
            <button
              onClick={stopMeeting}
              className="flex items-center gap-1.5 text-xs bg-red-700 hover:bg-red-600 text-white px-3 py-1.5 rounded transition-colors"
            >
              <Square className="w-3.5 h-3.5" />
              Stop
            </button>
          )}

          {/* Debrief button */}
          <button
            onClick={() => setShowDebrief(true)}
            disabled={transcript.length === 0}
            className="flex items-center gap-1.5 text-xs bg-gray-800 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed text-gray-300 px-3 py-1.5 rounded border border-gray-700 transition-colors"
          >
            <FileText className="w-3.5 h-3.5" />
            Debrief
          </button>

          {/* Knowledge Base link */}
          <Link
            href="/upload"
            className="text-xs text-gray-500 hover:text-indigo-400 transition-colors whitespace-nowrap"
          >
            Knowledge Base
          </Link>
        </div>
      </header>

      {/* Main content */}
      <div className="flex flex-1 min-h-0">
        {/* Left panel — Transcript */}
        <div className="flex flex-col w-[60%] border-r border-gray-800 min-h-0">
          <div className="flex-1 min-h-0">
            <TranscriptPanel
              transcript={transcript}
              isLive={isLive && !isPaused}
              interimText={interimText}
              interimSpeaker={interimSpeaker}
            />
          </div>

          {/* Status bar */}
          <div className="flex items-center justify-between h-8 px-3 border-t border-gray-800 bg-gray-900/50 flex-shrink-0">
            <div className="flex items-center gap-1.5 text-xs">
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  wsConnected ? "bg-green-500" : "bg-gray-600"
                }`}
              />
              <span className={wsConnected ? "text-green-400" : "text-gray-500"}>
                {wsConnected ? "Connected" : "Disconnected"}
              </span>
            </div>
            <span className="text-xs text-gray-600">
              {transcript.length} {transcript.length === 1 ? "entry" : "entries"}
            </span>
          </div>
        </div>

        {/* Right panel — AI Insights */}
        <div className="flex flex-col w-[40%] min-h-0 overflow-hidden">
          {/* Suggestions */}
          <div className="flex-none" style={{ height: "40%" }}>
            <SuggestionsPanel
              suggestions={suggestions}
              thinking={thinking}
              onRefresh={refreshSuggestions}
            />
          </div>

          {/* Key Points */}
          <div className="flex-1 min-h-0 border-t border-gray-800">
            <KeyPointsPanel keyPoints={keyPoints} />
          </div>

          {/* Action Items */}
          <div className="flex-none border-t border-gray-800">
            <ActionItemsPanel actionItems={actionItems} />
          </div>
        </div>
      </div>

      {/* Debrief Modal */}
      {showDebrief && (
        <DebriefChat
          onClose={() => setShowDebrief(false)}
          transcript={transcript}
          meetingId={meetingId}
        />
      )}

      {/* Toast notification */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-gray-800 border border-gray-700 text-gray-100 text-sm px-5 py-3 rounded-full shadow-xl animate-fade-in-up">
          <span className="w-2 h-2 rounded-full bg-green-400" />
          {toast}
        </div>
      )}
    </div>
  );
}
