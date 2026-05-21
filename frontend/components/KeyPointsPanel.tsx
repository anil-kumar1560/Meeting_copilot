"use client";

import { Bookmark } from "lucide-react";

interface KeyPointsPanelProps {
  keyPoints: string[];
}

export default function KeyPointsPanel({ keyPoints }: KeyPointsPanelProps) {
  return (
    <div className="flex flex-col h-full min-h-0 bg-[#0f1117]">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-800 flex-shrink-0">
        <Bookmark className="w-3.5 h-3.5 text-indigo-400" />
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
          Key Points
        </span>
        {keyPoints.length > 0 && (
          <span className="ml-auto text-xs bg-gray-800 text-gray-500 px-1.5 py-0.5 rounded-full">
            {keyPoints.length}
          </span>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2">
        {keyPoints.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-gray-600">Key points will appear here</p>
          </div>
        ) : (
          <ul className="space-y-1">
            {keyPoints.map((point, idx) => (
              <li
                key={idx}
                className="flex items-start gap-2 px-2 py-1.5 rounded hover:bg-gray-900 transition-colors animate-fade-in-up group"
              >
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-indigo-500 flex-shrink-0" />
                <span className="text-sm text-gray-300 leading-snug">{point}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
