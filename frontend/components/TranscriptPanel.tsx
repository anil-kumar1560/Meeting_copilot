"use client";

import { useEffect, useRef } from "react";
import { Mic } from "lucide-react";
import { TranscriptEntry } from "@/app/page";

interface TranscriptPanelProps {
  transcript: TranscriptEntry[];
  isLive?: boolean;
  interimText?: string;
  interimSpeaker?: string;
}

const SPEAKER_COLORS = [
  { text: "text-indigo-400", bg: "bg-indigo-900/20", border: "border-indigo-900/40" },
  { text: "text-emerald-400", bg: "bg-emerald-900/20", border: "border-emerald-900/40" },
  { text: "text-amber-400", bg: "bg-amber-900/20", border: "border-amber-900/40" },
  { text: "text-rose-400", bg: "bg-rose-900/20", border: "border-rose-900/40" },
  { text: "text-cyan-400", bg: "bg-cyan-900/20", border: "border-cyan-900/40" },
  { text: "text-violet-400", bg: "bg-violet-900/20", border: "border-violet-900/40" },
];

function formatTimestamp(epochMs: number): string {
  const d = new Date(epochMs);
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${mm}:${ss}`;
}

function getSpeakerColor(speaker: string, colorMap: Map<string, number>): (typeof SPEAKER_COLORS)[0] {
  if (!colorMap.has(speaker)) {
    colorMap.set(speaker, colorMap.size % SPEAKER_COLORS.length);
  }
  return SPEAKER_COLORS[colorMap.get(speaker)!];
}

export default function TranscriptPanel({ transcript, isLive = false, interimText = "", interimSpeaker = "" }: TranscriptPanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const colorMap = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    if (transcript.length > 0) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [transcript.length]);

  if (transcript.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-8 bg-[#0f1117]">
        <div className="w-16 h-16 rounded-full bg-gray-900 border border-gray-800 flex items-center justify-center mb-4">
          <Mic className="w-7 h-7 text-gray-700" />
        </div>
        <p className="text-gray-500 text-sm font-medium">Waiting for meeting to start...</p>
        <p className="text-gray-700 text-xs mt-1">
          Press Start Meeting to begin capturing audio
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[#0f1117]">
      {/* Panel header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800 flex-shrink-0">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
          Transcript
        </span>
        {isLive && (
          <div className="flex items-center gap-1.5 text-xs text-green-400">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            Receiving
          </div>
        )}
      </div>

      {/* Scrollable transcript */}
      <div className="flex-1 overflow-y-auto px-4 py-2 space-y-1">
        {transcript.map((entry, idx) => {
          const colors = getSpeakerColor(entry.speaker, colorMap.current);
          const prevEntry = idx > 0 ? transcript[idx - 1] : null;
          const isSameSpeaker = prevEntry?.speaker === entry.speaker;

          return (
            <div
              key={entry.id}
              className={`animate-fade-in-up rounded-lg px-3 py-2 border ${colors.bg} ${colors.border} ${
                isSameSpeaker ? "mt-0.5" : "mt-2"
              }`}
            >
              {!isSameSpeaker && (
                <div className="flex items-center justify-between mb-1">
                  <span className={`text-xs font-semibold ${colors.text}`}>
                    {entry.speaker}
                  </span>
                  <span className="text-xs text-gray-600 font-mono">
                    {formatTimestamp(entry.timestamp)}
                  </span>
                </div>
              )}
              {isSameSpeaker && (
                <div className="flex justify-end mb-0.5">
                  <span className="text-xs text-gray-700 font-mono">
                    {formatTimestamp(entry.timestamp)}
                  </span>
                </div>
              )}
              <p className="text-sm text-gray-200 leading-relaxed">{entry.text}</p>
            </div>
          );
        })}
        {/* Interim / ghost line */}
        {interimText && (
          <div className="rounded-lg px-3 py-2 border border-gray-800/50 bg-gray-900/30 mt-2 opacity-50">
            {interimSpeaker && (
              <span className="text-xs font-semibold text-gray-500 block mb-1">
                {interimSpeaker}
              </span>
            )}
            <p className="text-sm text-gray-400 leading-relaxed italic">{interimText}</p>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
