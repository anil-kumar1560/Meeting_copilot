"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { X, Send, Bot, User, Download, Clock, MessageSquare } from "lucide-react";
import { TranscriptEntry } from "@/app/page";

interface DebriefChatProps {
  onClose: () => void;
  transcript: TranscriptEntry[];
  meetingId?: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
}

interface PastMeeting {
  id: string;
  date: string;
  duration: string;
  transcript_count: number;
}

export default function DebriefChat({ onClose, transcript, meetingId }: DebriefChatProps) {
  const [tab, setTab] = useState<"chat" | "history">("chat");
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content:
        "Hello! I'm your meeting debrief assistant. I've reviewed the transcript — ask me anything about what was discussed, key decisions, follow-ups, or anything else.",
    },
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [pastMeetings, setPastMeetings] = useState<PastMeeting[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    inputRef.current?.focus();
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const fetchPastMeetings = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const res = await fetch("http://localhost:8000/meetings");
      if (res.ok) {
        const data = await res.json();
        setPastMeetings(data.meetings || []);
      }
    } catch {
      // ignore
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    if (tab === "history") fetchPastMeetings();
  }, [tab, fetchPastMeetings]);

  const downloadMeeting = useCallback(async (id: string) => {
    setDownloading(true);
    try {
      const res = await fetch(`http://localhost:8000/meetings/${id}/download`);
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${id}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // ignore
    } finally {
      setDownloading(false);
    }
  }, []);

  const sendMessage = useCallback(async () => {
    const question = input.trim();
    if (!question || isLoading) return;

    setInput("");
    setIsLoading(true);

    const history = messages.map((m) => ({ role: m.role, content: m.content }));

    setMessages((prev) => [
      ...prev,
      { role: "user", content: question },
      { role: "assistant", content: "", streaming: true },
    ]);

    abortRef.current = new AbortController();

    try {
      const response = await fetch("http://localhost:8000/debrief/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, history, transcript }),
        signal: abortRef.current.signal,
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (!response.body) throw new Error("No response body");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });
        setMessages((prev) => {
          const updated = [...prev];
          const lastIdx = updated.length - 1;
          if (updated[lastIdx]?.role === "assistant") {
            updated[lastIdx] = { ...updated[lastIdx], content: accumulated, streaming: true };
          }
          return updated;
        });
      }

      setMessages((prev) => {
        const updated = [...prev];
        const lastIdx = updated.length - 1;
        if (updated[lastIdx]?.role === "assistant") {
          updated[lastIdx] = { ...updated[lastIdx], streaming: false };
        }
        return updated;
      });
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") return;
      setMessages((prev) => {
        const updated = [...prev];
        const lastIdx = updated.length - 1;
        if (updated[lastIdx]?.role === "assistant" && updated[lastIdx].streaming) {
          updated[lastIdx] = {
            role: "assistant",
            content: "Sorry, I encountered an error. Please try again.",
            streaming: false,
          };
        }
        return updated;
      });
    } finally {
      setIsLoading(false);
    }
  }, [input, isLoading, messages, transcript]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleString(undefined, {
        month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
      });
    } catch {
      return iso;
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-8">
      <div className="flex flex-col bg-gray-900 border border-gray-800 rounded-xl w-4/5 h-4/5 max-w-4xl shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 flex-shrink-0">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Bot className="w-5 h-5 text-indigo-400" />
              <h2 className="text-base font-semibold text-gray-100">Meeting Debrief</h2>
            </div>
            {/* Tabs */}
            <div className="flex gap-1 bg-gray-800 rounded-lg p-1">
              <button
                onClick={() => setTab("chat")}
                className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md transition-colors ${
                  tab === "chat"
                    ? "bg-gray-700 text-gray-100"
                    : "text-gray-500 hover:text-gray-300"
                }`}
              >
                <MessageSquare className="w-3 h-3" />
                Chat
              </button>
              <button
                onClick={() => setTab("history")}
                className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md transition-colors ${
                  tab === "history"
                    ? "bg-gray-700 text-gray-100"
                    : "text-gray-500 hover:text-gray-300"
                }`}
              >
                <Clock className="w-3 h-3" />
                Past Meetings
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Download current meeting */}
            {meetingId && tab === "chat" && (
              <button
                onClick={() => downloadMeeting(meetingId)}
                disabled={downloading}
                className="flex items-center gap-1.5 text-xs bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-300 px-3 py-1.5 rounded border border-gray-700 transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                {downloading ? "Downloading…" : "Download Transcript"}
              </button>
            )}
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-gray-300 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tab: Chat */}
        {tab === "chat" && (
          <>
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              {messages.map((msg, idx) => (
                <div
                  key={idx}
                  className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : ""}`}
                >
                  <div
                    className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${
                      msg.role === "assistant"
                        ? "bg-indigo-900 border border-indigo-700"
                        : "bg-gray-800 border border-gray-700"
                    }`}
                  >
                    {msg.role === "assistant" ? (
                      <Bot className="w-3.5 h-3.5 text-indigo-400" />
                    ) : (
                      <User className="w-3.5 h-3.5 text-gray-400" />
                    )}
                  </div>
                  <div
                    className={`max-w-[75%] px-4 py-2.5 rounded-xl text-sm leading-relaxed ${
                      msg.role === "assistant"
                        ? "bg-gray-800 text-gray-200 rounded-tl-none"
                        : "bg-indigo-700 text-white rounded-tr-none"
                    }`}
                  >
                    {msg.content === "" && msg.streaming ? (
                      <span className="text-gray-500 italic animate-pulse">Thinking...</span>
                    ) : (
                      <>
                        {msg.content}
                        {msg.streaming && (
                          <span className="inline-block w-0.5 h-4 bg-indigo-400 ml-0.5 animate-pulse" />
                        )}
                      </>
                    )}
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>
            <div className="flex items-center gap-3 px-6 py-4 border-t border-gray-800 flex-shrink-0">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask anything about the meeting..."
                disabled={isLoading}
                className="flex-1 bg-gray-800 border border-gray-700 text-gray-200 placeholder-gray-600 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-indigo-600 disabled:opacity-50 transition-colors"
              />
              <button
                onClick={sendMessage}
                disabled={isLoading || !input.trim()}
                className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors"
              >
                <Send className="w-4 h-4" />
                Send
              </button>
            </div>
          </>
        )}

        {/* Tab: Past Meetings */}
        {tab === "history" && (
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {loadingHistory ? (
              <div className="flex items-center justify-center h-full">
                <span className="text-gray-500 text-sm animate-pulse">Loading meetings…</span>
              </div>
            ) : pastMeetings.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-2">
                <Clock className="w-8 h-8 text-gray-700" />
                <p className="text-gray-500 text-sm">No saved meetings yet</p>
                <p className="text-gray-700 text-xs">Meetings are saved when you click Stop</p>
              </div>
            ) : (
              <div className="space-y-2">
                {pastMeetings.map((m) => (
                  <div
                    key={m.id}
                    className="flex items-center justify-between bg-gray-800 border border-gray-700 rounded-lg px-4 py-3"
                  >
                    <div>
                      <p className="text-sm text-gray-200 font-medium">{formatDate(m.date)}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {m.duration} · {m.transcript_count} entries
                      </p>
                    </div>
                    <button
                      onClick={() => downloadMeeting(m.id)}
                      className="flex items-center gap-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-3 py-1.5 rounded border border-gray-600 transition-colors"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Download
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
