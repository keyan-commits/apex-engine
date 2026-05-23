"use client";

import { useEffect, useReducer, useState } from "react";
import { ChatInput } from "@/components/ChatInput";
import { HistorySidebar } from "@/components/HistorySidebar";
import { ModelPanel, type PanelState } from "@/components/ModelPanel";
import { ProjectSelector } from "@/components/ProjectSelector";
import { Settings } from "@/components/Settings";
import { SynthesizerPanel, type SynthState } from "@/components/SynthesizerPanel";
import type { HistoryAnswer, HistoryEntry } from "@/lib/history";
import type { Project } from "@/lib/projects";
import { PROVIDERS, type Provider } from "@/lib/providers";
import { parseSse, type SseEvent } from "@/lib/sse";
import {
  DEFAULT_SYNTHESIZER_ID,
  SYNTHESIZER_OPTIONS,
  findSynthesizer,
} from "@/lib/synthesizer-options";

const SYNTHESIZER_PREF_KEY = "apex.synthesizer";
const SYNTHESIZER_ID_KEY = "apex.synthesizer-id";

type State = {
  submitting: boolean;
  currentPrompt: string | null;
  selectedHistoryId: number | null;
  historyRefreshKey: number;
  activeProject: Project | null;
  models: Record<Provider, PanelState>;
  synth: SynthState;
};

function initialPanel(): PanelState {
  return { status: "idle", tier: null, model: null, text: "", error: null };
}

function initialState(): State {
  return {
    submitting: false,
    currentPrompt: null,
    selectedHistoryId: null,
    historyRefreshKey: 0,
    activeProject: null,
    models: {
      claude: initialPanel(),
      openai: initialPanel(),
      llama: initialPanel(),
      gemini: initialPanel(),
    },
    synth: { status: "idle", text: "", error: null },
  };
}

function answerToPanel(a: HistoryAnswer): PanelState {
  return {
    status: a.error ? "error" : "done",
    tier: a.tier,
    model: a.model,
    text: a.text,
    error: a.error,
  };
}

type Action =
  | { kind: "submit"; prompt: string }
  | { kind: "settle" }
  | { kind: "sse"; event: SseEvent }
  | { kind: "new-chat" }
  | { kind: "load-history"; entry: HistoryEntry }
  | { kind: "history-refresh" }
  | { kind: "set-project"; project: Project | null };

function reducer(state: State, action: Action): State {
  switch (action.kind) {
    case "submit": {
      const fresh = initialState();
      return {
        ...fresh,
        submitting: true,
        currentPrompt: action.prompt,
        selectedHistoryId: null,
        historyRefreshKey: state.historyRefreshKey,
        activeProject: state.activeProject,
      };
    }
    case "settle":
      return { ...state, submitting: false };
    case "new-chat": {
      const fresh = initialState();
      return {
        ...fresh,
        historyRefreshKey: state.historyRefreshKey,
        activeProject: state.activeProject,
      };
    }
    case "history-refresh":
      return { ...state, historyRefreshKey: state.historyRefreshKey + 1 };
    case "set-project":
      return {
        ...initialState(),
        historyRefreshKey: state.historyRefreshKey + 1,
        activeProject: action.project,
      };
    case "load-history": {
      const e = action.entry;
      return {
        submitting: false,
        currentPrompt: e.prompt,
        selectedHistoryId: e.id,
        historyRefreshKey: state.historyRefreshKey,
        activeProject: state.activeProject,
        models: {
          claude: answerToPanel(e.answers.claude),
          openai: answerToPanel(e.answers.openai),
          llama: answerToPanel(e.answers.llama),
          gemini: answerToPanel(e.answers.gemini),
        },
        synth: {
          status: e.synthError ? "error" : e.synthText ? "done" : "idle",
          text: e.synthText ?? "",
          error: e.synthError,
        },
      };
    }
    case "sse": {
      const ev = action.event;
      switch (ev.type) {
        case "open":
          return {
            ...state,
            models: {
              ...state.models,
              [ev.provider]: {
                ...state.models[ev.provider],
                status: "open",
                tier: ev.tier,
                model: ev.model,
              },
            },
          };
        case "delta":
          return {
            ...state,
            models: {
              ...state.models,
              [ev.provider]: {
                ...state.models[ev.provider],
                status: "streaming",
                text: state.models[ev.provider].text + ev.text,
              },
            },
          };
        case "done":
          return {
            ...state,
            models: {
              ...state.models,
              [ev.provider]: {
                ...state.models[ev.provider],
                status: "done",
              },
            },
          };
        case "error":
          if (ev.provider === "synthesizer") {
            return {
              ...state,
              synth: { ...state.synth, status: "error", error: ev.message },
            };
          }
          return {
            ...state,
            models: {
              ...state.models,
              [ev.provider]: {
                ...state.models[ev.provider],
                status: "error",
                error: ev.message,
              },
            },
          };
        case "synth-open":
          return { ...state, synth: { status: "open", text: "", error: null } };
        case "synth-delta":
          return {
            ...state,
            synth: {
              ...state.synth,
              status: "streaming",
              text: state.synth.text + ev.text,
            },
          };
        case "synth-done":
          return { ...state, synth: { ...state.synth, status: "done" } };
      }
    }
  }
}

export default function Home() {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const [synthesizerEnabled, setSynthesizerEnabled] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    const saved = window.localStorage.getItem(SYNTHESIZER_PREF_KEY);
    return saved === null ? true : saved === "true";
  });
  const [synthesizerId, setSynthesizerId] = useState<string>(() => {
    if (typeof window === "undefined") return DEFAULT_SYNTHESIZER_ID;
    const stored =
      window.localStorage.getItem(SYNTHESIZER_ID_KEY) ?? DEFAULT_SYNTHESIZER_ID;
    return SYNTHESIZER_OPTIONS.some((o) => o.id === stored)
      ? stored
      : DEFAULT_SYNTHESIZER_ID;
  });
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    window.localStorage.setItem(
      SYNTHESIZER_PREF_KEY,
      String(synthesizerEnabled),
    );
  }, [synthesizerEnabled]);

  useEffect(() => {
    window.localStorage.setItem(SYNTHESIZER_ID_KEY, synthesizerId);
  }, [synthesizerId]);

  async function handleSubmit(prompt: string) {
    dispatch({ kind: "submit", prompt });
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          projectId: state.activeProject?.id ?? null,
          synthesize: synthesizerEnabled,
          synthesizerId,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      for await (const event of parseSse(res)) {
        dispatch({ kind: "sse", event });
      }
    } catch (err) {
      console.error(err);
    } finally {
      dispatch({ kind: "settle" });
      dispatch({ kind: "history-refresh" });
    }
  }

  async function handleResynthesize() {
    if (state.selectedHistoryId == null) return;
    try {
      const res = await fetch("/api/resynthesize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: state.selectedHistoryId,
          synthesizerId,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      for await (const event of parseSse(res)) {
        dispatch({ kind: "sse", event });
      }
    } catch (err) {
      console.error(err);
    } finally {
      dispatch({ kind: "history-refresh" });
    }
  }

  const viewingHistory = state.selectedHistoryId !== null;
  const synthInFlight =
    state.synth.status === "open" || state.synth.status === "streaming";
  const showSynth =
    synthesizerEnabled ||
    state.synth.text ||
    state.synth.error ||
    viewingHistory;

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 flex">
      <HistorySidebar
        onLoad={(entry) => dispatch({ kind: "load-history", entry })}
        onNew={() => dispatch({ kind: "new-chat" })}
        refreshKey={state.historyRefreshKey}
        selectedId={state.selectedHistoryId}
        projectId={state.activeProject?.id ?? null}
      />
      <main className="flex-1 min-w-0">
        <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
          <header className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-4">
              <h1 className="text-2xl font-bold tracking-tight">Apex Engine</h1>
              <ProjectSelector
                active={state.activeProject}
                onChange={(project) =>
                  dispatch({ kind: "set-project", project })
                }
              />
            </div>
            <div className="flex items-center gap-3">
              <p className="text-xs text-neutral-500">
                Multi-LLM fan-out · Mixture of Agents
              </p>
              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                aria-label="Settings"
                className="text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 text-lg leading-none w-8 h-8 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 transition flex items-center justify-center"
              >
                ⚙
              </button>
            </div>
          </header>

          <ChatInput
            onSubmit={handleSubmit}
            disabled={state.submitting}
            synthesizerEnabled={synthesizerEnabled}
            onToggleSynthesizer={setSynthesizerEnabled}
          />

          {state.currentPrompt && (
            <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white/50 dark:bg-neutral-900/50 p-3 text-sm">
              <div className="text-[10px] uppercase tracking-wide text-neutral-500 mb-1">
                Question
              </div>
              <div className="whitespace-pre-wrap">{state.currentPrompt}</div>
            </div>
          )}

          <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {PROVIDERS.map((p) => (
              <ModelPanel key={p} provider={p} state={state.models[p]} />
            ))}
          </section>

          {showSynth && (
            <SynthesizerPanel
              state={state.synth}
              synthesizerLabel={findSynthesizer(synthesizerId).label}
              onResynthesize={viewingHistory ? handleResynthesize : undefined}
              resynthDisabled={synthInFlight}
            />
          )}
        </div>
      </main>

      <Settings
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        synthesizerId={synthesizerId}
        onChangeSynthesizer={setSynthesizerId}
      />
    </div>
  );
}
