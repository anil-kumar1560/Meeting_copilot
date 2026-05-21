"use client";

import { CheckSquare, Circle } from "lucide-react";

interface ActionItemsPanelProps {
  actionItems: string[];
}

export default function ActionItemsPanel({ actionItems }: ActionItemsPanelProps) {
  return (
    <div className="flex flex-col bg-[#0f1117] max-h-52 min-h-0">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-800 flex-shrink-0">
        <CheckSquare className="w-3.5 h-3.5 text-indigo-400" />
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
          Action Items
        </span>
        {actionItems.length > 0 && (
          <span className="ml-auto text-xs bg-gray-800 text-gray-500 px-1.5 py-0.5 rounded-full">
            {actionItems.length}
          </span>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2">
        {actionItems.length === 0 ? (
          <div className="flex items-center justify-center py-4">
            <p className="text-sm text-gray-600">No action items detected yet</p>
          </div>
        ) : (
          <ul className="space-y-1">
            {actionItems.map((item, idx) => (
              <li
                key={idx}
                className="flex items-start gap-2 px-2 py-1.5 rounded hover:bg-gray-900 transition-colors animate-fade-in-up"
              >
                <Circle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-gray-600" />
                <span className="text-sm text-gray-300 leading-snug">{item}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
