"use client";

import { memo, useEffect, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import remarkGfm from "remark-gfm";

function CodeBlock({ language, value }: { language: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative group">
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            // ignore
          }
        }}
        className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 text-[10px] px-1.5 py-0.5 rounded bg-neutral-700/80 text-white hover:bg-neutral-600 transition"
      >
        {copied ? "✓ Copied" : "Copy"}
      </button>
      <SyntaxHighlighter
        language={language || "text"}
        style={oneDark}
        customStyle={{ fontSize: "12px", borderRadius: "6px", margin: 0 }}
        PreTag="div"
      >
        {value.replace(/\n$/, "")}
      </SyntaxHighlighter>
    </div>
  );
}

const components: Components = {
  code(props) {
    const { className, children, ...rest } = props;
    const inline = !className?.includes("language-");
    if (inline) {
      return (
        <code
          {...rest}
          className="px-1 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800 text-[0.85em]"
        >
          {children}
        </code>
      );
    }
    const match = /language-(\w+)/.exec(className ?? "");
    const language = match ? match[1] : "";
    const value = String(children ?? "");
    return <CodeBlock language={language} value={value} />;
  },
};

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
    <div className="prose prose-sm prose-neutral dark:prose-invert max-w-none prose-pre:bg-transparent prose-pre:p-0">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {render}
      </ReactMarkdown>
    </div>
  );
}

export const Markdown = memo(MarkdownInner);
