"use client";

import { FileText, ExternalLink } from "lucide-react";
import Link from "next/link";

interface Document {
  filename: string;
  chunk_count: number;
  size?: number;
}

interface KnowledgeBaseProps {
  documents: Document[];
}

export default function KnowledgeBase({ documents }: KnowledgeBaseProps) {
  return (
    <div className="flex flex-col bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800">
        <div className="flex items-center gap-1.5">
          <FileText className="w-3.5 h-3.5 text-indigo-400" />
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
            Knowledge Base
          </span>
        </div>
        <Link
          href="/upload"
          className="flex items-center gap-1 text-xs text-gray-600 hover:text-indigo-400 transition-colors"
        >
          Manage
          <ExternalLink className="w-2.5 h-2.5" />
        </Link>
      </div>

      {/* Document list */}
      <div className="overflow-y-auto max-h-40">
        {documents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-5 text-center">
            <p className="text-xs text-gray-600">No documents</p>
            <Link
              href="/upload"
              className="text-xs text-indigo-500 hover:text-indigo-400 mt-1 transition-colors"
            >
              Upload documents →
            </Link>
          </div>
        ) : (
          <ul className="divide-y divide-gray-800">
            {documents.map((doc) => (
              <li
                key={doc.filename}
                className="flex items-center gap-2 px-3 py-2 hover:bg-gray-800/50 transition-colors"
              >
                <FileText className="w-3 h-3 text-gray-600 flex-shrink-0" />
                <span className="flex-1 text-xs text-gray-300 truncate" title={doc.filename}>
                  {doc.filename}
                </span>
                <span className="text-[10px] text-gray-600 flex-shrink-0">
                  {doc.chunk_count}c
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
