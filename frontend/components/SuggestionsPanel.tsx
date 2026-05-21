"use client";

import { useState } from "react";
import { RefreshCw, Copy, Check, MessageSquare } from "lucide-react";
import { SuggestedQuestion } from "@/app/page";

interface SuggestionsPanelProps {
  suggestions: SuggestedQuestion[];
  thinking: boolean;
  onRefresh: () => void;
}

const TYPE_STYLES = {
  clarifying: {
    badge: "bg-blue-900/50 text-blue-300 border border-blue-800",
    label: "Clarifying",
  },
  bridging: {
    badge: "bg-purple-900/50 text-purple-300 border border-purple-800",
    label: "Bridging",
  },
  pressure: {
    badge: "bg-orange-900/50 text-orange-300 border border-orange-800",
    label: "Pressure",
  },
};

function SkeletonCard() {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-3 animate-pulse">
      <div className="flex items-center gap-2 mb-2">
        <div className="h-4 w-16 bg-gray-800 rounded-full" />
        <div className="h-3 w-24 bg-gray-800 rounded" />
      </div>
      <div className="space-y-1.5">
        <div className="h-3 bg-gray-800 rounded w-full" />
        <div className="h-3 bg-gray-800 rounded w-4/5" />
      </div>
      <div className="mt-2 h-3 bg-gray-800/60 rounded w-3/4" />
      <p className="text-xs text-gray-600 mt-1 italic">thinking...</p>
    </div>
  );
}

function SuggestionCard({ suggestion }: { suggestion: SuggestedQuestion }) {
  const [copied, setCopied] = useState(false);
  const styles = TYPE_STYLES[suggestion.type] ?? TYPE_STYLES.clarifying;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(suggestion.question);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback: ignore
    }
  };

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-3 hover:border-gray-700 transition-colors animate-fade-in-up">
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${styles.badge}`}>
          {styles.label}
        </span>
        <button
          onClick={handleCopy}
          className={`flex items-center gap-1 text-[10px] px-2 py-0.5 rounded transition-colors flex-shrink-0 ${
            copied
              ? "text-green-400 bg-green-900/30"
              : "text-gray-500 hover:text-gray-300 hover:bg-gray-800"
          }`}
        >
          {copied ? (
            <>
              <Check className="w-2.5 h-2.5" />
              Copied!
            </>
          ) : (
            <>
              <Copy className="w-2.5 h-2.5" />
              Copy
            </>
          )}
        </button>
      </div>
      <p className="text-sm font-medium text-gray-100 leading-snug mb-1">
        {suggestion.question}
      </p>
      {suggestion.context && (
        <p className="text-xs text-gray-500 leading-snug">{suggestion.context}</p>
      )}
    </div>
  );
}

export default function SuggestionsPanel({
  suggestions,
  thinking,
  onRefresh,
}: SuggestionsPanelProps) {
  return (
    <div className="flex flex-col h-full bg-[#0f1117]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800 flex-shrink-0">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-3.5 h-3.5 text-indigo-400" />
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
            Suggested Questions
          </span>
        </div>
        <button
          onClick={onRefresh}
          disabled={thinking}
          className="text-gray-500 hover:text-indigo-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          title="Refresh suggestions"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 ${thinking ? "animate-spin text-indigo-400" : ""}`}
          />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {thinking ? (
          <>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </>
        ) : suggestions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-8">
            <MessageSquare className="w-8 h-8 text-gray-800 mb-2" />
            <p className="text-sm text-gray-600">Start meeting to get suggestions</p>
          </div>
        ) : (
          suggestions.slice(0, 3).map((suggestion, idx) => (
            <SuggestionCard key={idx} suggestion={suggestion} />
          ))
        )}
      </div>
    </div>
  );
}
