"use client";

import { memo, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// React-markdown re-parses on every prop change. During fast streaming this
// thrashes layout — coalesce updates to ~30fps via rAF instead.
function MarkdownInner({ children }: { children: string }) {
  const [render, setRender] = useState(children);
  useEffect(() => {
    let frame: number | null = null;
    frame = requestAnimationFrame(() => setRender(children));
    return () => {
      if (frame != null) cancelAnimationFrame(frame);
    };
  }, [children]);
  return (
    <div className="prose prose-sm prose-neutral dark:prose-invert max-w-none prose-pre:bg-neutral-100 dark:prose-pre:bg-neutral-950 prose-pre:text-xs">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{render}</ReactMarkdown>
    </div>
  );
}

export const Markdown = memo(MarkdownInner);
