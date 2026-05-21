"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { ArrowLeft, Upload, FileText, Trash2, CheckCircle, AlertCircle, Tag, X, Plus } from "lucide-react";
import Link from "next/link";

interface UploadedDocument {
  filename: string;
  chunk_count: number;
  size?: number;
}

interface FileUploadStatus {
  file: File;
  status: "pending" | "uploading" | "done" | "error";
  error?: string;
}

export default function UploadPage() {
  const [documents, setDocuments] = useState<UploadedDocument[]>([]);
  const [uploadQueue, setUploadQueue] = useState<FileUploadStatus[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [isLoadingDocs, setIsLoadingDocs] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchDocuments = useCallback(async () => {
    try {
      const res = await fetch("http://localhost:8000/documents");
      if (res.ok) {
        const data = await res.json();
        setDocuments(Array.isArray(data) ? data : data.documents ?? []);
      }
    } catch {
      // Backend may not be running
    } finally {
      setIsLoadingDocs(false);
    }
  }, []);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  const uploadFile = useCallback(async (file: File, idx: number) => {
    setUploadQueue((prev) =>
      prev.map((item, i) => (i === idx ? { ...item, status: "uploading" } : item))
    );

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("http://localhost:8000/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        throw new Error(`Upload failed: ${res.statusText}`);
      }

      setUploadQueue((prev) =>
        prev.map((item, i) => (i === idx ? { ...item, status: "done" } : item))
      );

      // Refresh document list
      await fetchDocuments();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Upload failed";
      setUploadQueue((prev) =>
        prev.map((item, i) =>
          i === idx ? { ...item, status: "error", error: message } : item
        )
      );
    }
  }, [fetchDocuments]);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files) return;
      const allowed = Array.from(files).filter((f) =>
        [".pdf", ".docx", ".txt"].some((ext) => f.name.toLowerCase().endsWith(ext))
      );

      const startIdx = uploadQueue.length;
      const newItems: FileUploadStatus[] = allowed.map((f) => ({
        file: f,
        status: "pending",
      }));

      setUploadQueue((prev) => [...prev, ...newItems]);

      // Start uploads
      newItems.forEach((item, i) => {
        uploadFile(item.file, startIdx + i);
      });
    },
    [uploadQueue.length, uploadFile]
  );

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    handleFiles(e.dataTransfer.files);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => setIsDragOver(false);

  const deleteDocument = async (filename: string) => {
    try {
      const res = await fetch(
        `http://localhost:8000/documents/${encodeURIComponent(filename)}`,
        { method: "DELETE" }
      );
      if (res.ok) {
        setDocuments((prev) => prev.filter((d) => d.filename !== filename));
      }
    } catch {
      // ignore
    }
  };

  const addTag = () => {
    const trimmed = tagInput.trim();
    if (!trimmed || tags.includes(trimmed)) return;
    setTags((prev) => [...prev, trimmed]);
    setTagInput("");
  };

  const removeTag = (tag: string) => {
    setTags((prev) => prev.filter((t) => t !== tag));
  };

  const clearCompleted = () => {
    setUploadQueue((prev) => prev.filter((item) => item.status !== "done"));
  };

  return (
    <div className="min-h-screen bg-[#0f1117] text-gray-100">
      {/* Header */}
      <header className="flex items-center gap-4 px-6 py-4 border-b border-gray-800">
        <Link
          href="/"
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-indigo-400 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </Link>
        <div className="w-px h-4 bg-gray-800" />
        <h1 className="text-base font-semibold text-gray-100">Knowledge Base</h1>
        <span className="text-xs text-gray-600">
          Upload documents to enhance meeting context
        </span>
      </header>

      <div className="max-w-3xl mx-auto px-6 py-8 space-y-8">
        {/* Upload zone */}
        <section>
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
            Upload Documents
          </h2>

          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => fileInputRef.current?.click()}
            className={`relative border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all ${
              isDragOver
                ? "border-indigo-500 bg-indigo-900/20"
                : "border-gray-700 hover:border-indigo-700 hover:bg-gray-900/50"
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.docx,.txt"
              onChange={(e) => handleFiles(e.target.files)}
              className="hidden"
            />
            <Upload
              className={`w-10 h-10 mx-auto mb-3 ${
                isDragOver ? "text-indigo-400" : "text-gray-600"
              }`}
            />
            <p className="text-sm font-medium text-gray-300 mb-1">
              {isDragOver ? "Drop files here" : "Drag & drop files here"}
            </p>
            <p className="text-xs text-gray-600">
              or click to browse — PDF, DOCX, TXT supported
            </p>
          </div>

          {/* Upload queue */}
          {uploadQueue.length > 0 && (
            <div className="mt-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">Upload queue</span>
                <button
                  onClick={clearCompleted}
                  className="text-xs text-gray-600 hover:text-gray-400 transition-colors"
                >
                  Clear completed
                </button>
              </div>
              {uploadQueue.map((item, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-3 bg-gray-900 border border-gray-800 rounded-lg px-3 py-2"
                >
                  <FileText className="w-4 h-4 text-gray-600 flex-shrink-0" />
                  <span className="flex-1 text-sm text-gray-300 truncate">
                    {item.file.name}
                  </span>
                  <span className="text-xs text-gray-600 flex-shrink-0">
                    {(item.file.size / 1024).toFixed(0)} KB
                  </span>

                  {item.status === "pending" && (
                    <span className="text-xs text-gray-600">Pending...</span>
                  )}
                  {item.status === "uploading" && (
                    <div className="flex items-center gap-1 text-xs text-indigo-400">
                      <div className="w-3 h-3 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
                      Uploading
                    </div>
                  )}
                  {item.status === "done" && (
                    <div className="flex items-center gap-1 text-xs text-green-400">
                      <CheckCircle className="w-3.5 h-3.5" />
                      Done
                    </div>
                  )}
                  {item.status === "error" && (
                    <div className="flex items-center gap-1 text-xs text-red-400" title={item.error}>
                      <AlertCircle className="w-3.5 h-3.5" />
                      Error
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Topic tags */}
        <section>
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
            Topic Tags for Retrieval
          </h2>
          <p className="text-xs text-gray-600 mb-3">
            Tags help focus retrieval on relevant context during meetings.
          </p>

          <div className="flex flex-wrap gap-2 mb-3">
            {tags.map((tag) => (
              <span
                key={tag}
                className="flex items-center gap-1.5 text-xs bg-indigo-900/40 text-indigo-300 border border-indigo-800 px-3 py-1 rounded-full"
              >
                <Tag className="w-2.5 h-2.5" />
                {tag}
                <button
                  onClick={() => removeTag(tag)}
                  className="hover:text-white ml-0.5"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </span>
            ))}
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addTag()}
              placeholder="Add a topic tag..."
              className="flex-1 bg-gray-900 border border-gray-700 text-gray-300 placeholder-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-600"
            />
            <button
              onClick={addTag}
              className="flex items-center gap-1.5 bg-indigo-700 hover:bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add
            </button>
          </div>
        </section>

        {/* Documents list */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
              Uploaded Documents
            </h2>
            <button
              onClick={fetchDocuments}
              className="text-xs text-gray-600 hover:text-gray-400 transition-colors"
            >
              Refresh
            </button>
          </div>

          {isLoadingDocs ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-14 bg-gray-900 border border-gray-800 rounded-lg animate-pulse"
                />
              ))}
            </div>
          ) : documents.length === 0 ? (
            <div className="text-center py-10 text-gray-600 border border-gray-800 rounded-xl">
              <FileText className="w-8 h-8 mx-auto mb-2 text-gray-800" />
              <p className="text-sm">No documents uploaded yet</p>
            </div>
          ) : (
            <div className="space-y-2">
              {documents.map((doc) => (
                <div
                  key={doc.filename}
                  className="flex items-center gap-3 bg-gray-900 border border-gray-800 rounded-lg px-4 py-3 hover:border-gray-700 transition-colors"
                >
                  <FileText className="w-4 h-4 text-indigo-400 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-200 truncate">{doc.filename}</p>
                    <p className="text-xs text-gray-600 mt-0.5">
                      {doc.chunk_count} chunk{doc.chunk_count !== 1 ? "s" : ""}
                      {doc.size && ` · ${(doc.size / 1024).toFixed(0)} KB`}
                    </p>
                  </div>
                  <button
                    onClick={() => deleteDocument(doc.filename)}
                    className="text-gray-700 hover:text-red-400 transition-colors flex-shrink-0"
                    title="Delete document"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
