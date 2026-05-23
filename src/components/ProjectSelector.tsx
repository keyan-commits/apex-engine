"use client";

import { useEffect, useState } from "react";
import type { Project } from "@/lib/projects";

export function ProjectSelector({
  active,
  onChange,
}: {
  active: Project | null;
  onChange: (project: Project | null) => void;
}) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [open, setOpen] = useState(false);
  const [modal, setModal] = useState<
    { mode: "create" } | { mode: "edit"; project: Project } | null
  >(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/projects")
      .then((r) => r.json())
      .then((data: Project[]) => {
        if (cancelled) return;
        setProjects(data);
        if (active && !data.some((p) => p.id === active.id)) onChange(null);
      })
      .catch(() => {
        if (!cancelled) setProjects([]);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey, active, onChange]);

  async function handleDelete(p: Project) {
    if (!confirm(`Delete project "${p.name}"? History entries are kept.`))
      return;
    await fetch("/api/projects", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: p.id }),
    });
    if (active?.id === p.id) onChange(null);
    setRefreshKey((n) => n + 1);
  }

  return (
    <>
      <div className="relative inline-block">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 text-sm transition"
        >
          <span className="text-xs text-neutral-500">Project:</span>
          <span className="font-medium">{active?.name ?? "None"}</span>
          <span className="text-neutral-400 text-xs">▾</span>
        </button>

        {open && (
          <>
            <div
              className="fixed inset-0 z-10"
              onClick={() => setOpen(false)}
            />
            <div className="absolute top-full left-0 mt-2 w-72 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-xl z-20 overflow-hidden">
              <button
                type="button"
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                }}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800 ${active === null ? "font-semibold bg-neutral-50 dark:bg-neutral-950" : ""}`}
              >
                None
                <span className="block text-[10px] text-neutral-500 font-normal">
                  Default assistant — no project instructions
                </span>
              </button>
              <div className="max-h-64 overflow-y-auto">
                {projects.length === 0 ? (
                  <p className="text-xs text-neutral-500 px-3 py-2">
                    No projects yet
                  </p>
                ) : (
                  projects.map((p) => (
                    <div
                      key={p.id}
                      className={`group flex items-center hover:bg-neutral-100 dark:hover:bg-neutral-800 ${active?.id === p.id ? "bg-neutral-50 dark:bg-neutral-950" : ""}`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          onChange(p);
                          setOpen(false);
                        }}
                        className="flex-1 text-left px-3 py-2 text-sm truncate"
                      >
                        <span
                          className={
                            active?.id === p.id ? "font-semibold" : ""
                          }
                        >
                          {p.name}
                        </span>
                        {p.description && (
                          <span className="block text-[10px] text-neutral-500 font-normal truncate">
                            {p.description}
                          </span>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setModal({ mode: "edit", project: p });
                          setOpen(false);
                        }}
                        className="opacity-0 group-hover:opacity-100 px-2 text-xs text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 transition"
                      >
                        edit
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(p);
                        }}
                        className="opacity-0 group-hover:opacity-100 px-2 text-base text-neutral-400 hover:text-red-500 transition"
                        aria-label="Delete project"
                      >
                        ×
                      </button>
                    </div>
                  ))
                )}
              </div>
              <div className="border-t border-neutral-200 dark:border-neutral-800">
                <button
                  type="button"
                  onClick={() => {
                    setModal({ mode: "create" });
                    setOpen(false);
                  }}
                  className="w-full text-left px-3 py-2 text-sm text-blue-600 dark:text-blue-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                >
                  + New Project
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {modal && (
        <ProjectModal
          initial={modal.mode === "edit" ? modal.project : null}
          onClose={() => setModal(null)}
          onSaved={(saved) => {
            setRefreshKey((n) => n + 1);
            if (modal.mode === "create") onChange(saved);
            else if (active?.id === saved.id) onChange(saved);
          }}
        />
      )}
    </>
  );
}

function ProjectModal({
  initial,
  onClose,
  onSaved,
}: {
  initial: Project | null;
  onClose: () => void;
  onSaved: (project: Project) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [systemPrompt, setSystemPrompt] = useState(initial?.systemPrompt ?? "");
  const [saving, setSaving] = useState(false);

  const canSave = name.trim().length > 0 && systemPrompt.trim().length > 0;

  async function save() {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      if (initial) {
        await fetch("/api/projects", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: initial.id,
            name: name.trim(),
            description: description.trim() || null,
            systemPrompt: systemPrompt.trim(),
          }),
        });
        onSaved({
          ...initial,
          name: name.trim(),
          description: description.trim() || null,
          systemPrompt: systemPrompt.trim(),
        });
      } else {
        const res = await fetch("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            description: description.trim() || null,
            systemPrompt: systemPrompt.trim(),
          }),
        });
        const { id } = (await res.json()) as { id: number };
        onSaved({
          id,
          createdAt: Date.now(),
          name: name.trim(),
          description: description.trim() || null,
          systemPrompt: systemPrompt.trim(),
        });
      }
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-neutral-900 rounded-xl shadow-2xl w-full max-w-lg p-5">
        <h2 className="text-lg font-semibold mb-4">
          {initial ? "Edit Project" : "New Project"}
        </h2>
        <div className="space-y-3">
          <div>
            <label className="text-[10px] uppercase tracking-wide text-neutral-500">
              Name
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full mt-1 px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-transparent text-sm outline-none focus:border-neutral-400 dark:focus:border-neutral-500"
              placeholder="e.g., Coding Tutor"
              autoFocus
            />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wide text-neutral-500">
              Description (optional)
            </label>
            <input
              value={description ?? ""}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full mt-1 px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-transparent text-sm outline-none focus:border-neutral-400 dark:focus:border-neutral-500"
              placeholder="One-line summary"
            />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wide text-neutral-500">
              System prompt (instructions)
            </label>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              rows={8}
              className="w-full mt-1 px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-transparent text-sm font-mono outline-none focus:border-neutral-400 dark:focus:border-neutral-500"
              placeholder="You are a helpful tutor for high-school math. Walk through problems step by step, ask questions to check understanding, and end with a brief recap."
            />
            <p className="text-[10px] text-neutral-500 mt-1">
              Applied to all four LLMs and the synthesizer for every query in
              this project.
            </p>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800 transition"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={!canSave || saving}
              className="px-4 py-2 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
