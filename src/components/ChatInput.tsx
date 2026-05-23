"use client";

import { useEffect, useRef, useState } from "react";

const MAX_FILES = 5;
const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPT = "image/png,image/jpeg,image/gif,image/webp,text/plain,text/markdown,.md,application/pdf";

type Attached = {
  file: File;
  previewUrl?: string;
};

function isAcceptableFile(file: File): boolean {
  if (file.size > MAX_BYTES) return false;
  return (
    file.type.startsWith("image/") ||
    file.type === "text/plain" ||
    file.type === "text/markdown" ||
    file.name.endsWith(".md") ||
    file.type === "application/pdf"
  );
}

function makePreview(file: File): Attached {
  if (file.type.startsWith("image/")) {
    return { file, previewUrl: URL.createObjectURL(file) };
  }
  return { file };
}

export function ChatInput({
  onSubmit,
  onStop,
  streaming,
  synthesizerEnabled,
  onToggleSynthesizer,
}: {
  onSubmit: (prompt: string, files: File[]) => void;
  onStop: () => void;
  streaming: boolean;
  synthesizerEnabled: boolean;
  onToggleSynthesizer: (enabled: boolean) => void;
}) {
  const [value, setValue] = useState("");
  const [attached, setAttached] = useState<Attached[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Revoke object URLs when attachments change/unmount.
  useEffect(() => {
    return () => {
      for (const a of attached) {
        if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
      }
    };
  }, [attached]);

  function addFiles(incoming: FileList | File[]) {
    const next: Attached[] = [...attached];
    for (const f of Array.from(incoming)) {
      if (next.length >= MAX_FILES) break;
      if (!isAcceptableFile(f)) continue;
      if (next.some((a) => a.file.name === f.name && a.file.size === f.size)) continue;
      next.push(makePreview(f));
    }
    setAttached(next);
  }

  function removeAt(idx: number) {
    setAttached((prev) => {
      const a = prev[idx];
      if (a?.previewUrl) URL.revokeObjectURL(a.previewUrl);
      return prev.filter((_, i) => i !== idx);
    });
  }

  function submit() {
    const v = value.trim();
    if (!v || streaming) return;
    onSubmit(v, attached.map((a) => a.file));
    setValue("");
    for (const a of attached) {
      if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
    }
    setAttached([]);
  }

  function onPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const items = e.clipboardData.items;
    const files: File[] = [];
    for (const it of items) {
      if (it.kind === "file") {
        const f = it.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length) {
      e.preventDefault();
      addFiles(files);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!dragOver) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      className={`rounded-xl border bg-white dark:bg-neutral-900 p-3 shadow-sm transition ${
        dragOver
          ? "border-blue-400 ring-2 ring-blue-200 dark:ring-blue-800"
          : "border-neutral-200 dark:border-neutral-800"
      }`}
    >
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onPaste={onPaste}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder={
          dragOver
            ? "Drop files to attach…"
            : "Ask anything…  (Enter to submit · Shift+Enter for newline · Esc to stop)"
        }
        rows={3}
        className="w-full resize-none bg-transparent text-sm outline-none placeholder:text-neutral-400"
        disabled={streaming}
      />
      {attached.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-2 border-t border-neutral-100 dark:border-neutral-800 mt-2">
          {attached.map((a, idx) => (
            <div
              key={`${a.file.name}-${idx}`}
              className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-neutral-100 dark:bg-neutral-800 text-[11px]"
            >
              {a.previewUrl ? (
                <img
                  src={a.previewUrl}
                  alt={a.file.name}
                  className="w-6 h-6 rounded object-cover"
                />
              ) : (
                <span className="w-6 h-6 rounded bg-neutral-200 dark:bg-neutral-700 flex items-center justify-center text-[9px] uppercase">
                  {a.file.name.split(".").pop()?.slice(0, 3) ?? "?"}
                </span>
              )}
              <span className="max-w-[150px] truncate" title={a.file.name}>
                {a.file.name}
              </span>
              <span className="text-neutral-500">
                {(a.file.size / 1024).toFixed(0)}kb
              </span>
              <button
                type="button"
                onClick={() => removeAt(idx)}
                className="text-neutral-500 hover:text-red-500 ml-0.5"
                aria-label={`Remove ${a.file.name}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between pt-2">
        <div className="flex items-center gap-3 text-xs text-neutral-500">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={streaming || attached.length >= MAX_FILES}
            className="w-7 h-7 rounded-md hover:bg-neutral-100 dark:hover:bg-neutral-800 flex items-center justify-center disabled:opacity-40 transition"
            aria-label="Attach files"
            title="Attach images, text, markdown, or PDF"
          >
            📎
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ACCEPT}
            hidden
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            role="switch"
            aria-checked={synthesizerEnabled}
            onClick={() => onToggleSynthesizer(!synthesizerEnabled)}
            className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition ${
              synthesizerEnabled
                ? "bg-blue-500"
                : "bg-neutral-300 dark:bg-neutral-700"
            }`}
            aria-label="Toggle synthesizer"
          >
            <span
              className={`inline-block h-3 w-3 rounded-full bg-white transition-transform ${
                synthesizerEnabled ? "translate-x-5" : "translate-x-1"
              }`}
            />
          </button>
          <span className="select-none">Synthesize</span>
        </div>
        {streaming ? (
          <button
            type="button"
            onClick={onStop}
            className="rounded-lg bg-red-600 text-white text-sm font-medium px-4 py-1.5 hover:bg-red-700 transition flex items-center gap-2"
            aria-label="Stop streaming (Esc)"
          >
            <span className="inline-block w-2.5 h-2.5 bg-white rounded-[1px]" />
            Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={!value.trim()}
            className="rounded-lg bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 text-sm font-medium px-4 py-1.5 hover:bg-neutral-700 dark:hover:bg-neutral-300 disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            Submit
          </button>
        )}
      </div>
    </div>
  );
}
