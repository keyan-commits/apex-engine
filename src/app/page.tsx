"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import { ChatInput } from "@/components/ChatInput";
import { EnsemblePicker } from "@/components/EnsemblePicker";
import { HistorySidebar } from "@/components/HistorySidebar";
import { ModelPanel, type PanelState } from "@/components/ModelPanel";
import { ProjectSelector } from "@/components/ProjectSelector";
import { Settings } from "@/components/Settings";
import { ShortcutsHelp } from "@/components/ShortcutsHelp";
import { FeedbackButton } from "@/components/FeedbackButton";
import { StatsChip } from "@/components/StatsChip";
import { SubagentsPanel } from "@/components/SubagentsPanel";
import { SynthesizerPanel, type SynthState } from "@/components/SynthesizerPanel";
import type { AttachmentMeta } from "@/lib/attachments";
import type { HistoryAnswer, HistoryEntry } from "@/lib/history";
import type { Project } from "@/lib/projects";
import { PROVIDER_LABELS, PROVIDERS, type Provider } from "@/lib/providers";
import {
  DEFAULT_ENSEMBLE_ID,
  ENSEMBLE_LIST,
  ENSEMBLES,
  type EnsembleId,
} from "@/lib/roles";
import { parseSse, type SseEvent } from "@/lib/sse";
import {
  DEFAULT_SYNTH_STYLE,
  SYNTH_STYLES,
  type SynthStyleId,
} from "@/lib/synth-styles";
import {
  DEFAULT_SYNTHESIZER_ID,
  SYNTHESIZER_OPTIONS,
  findSynthesizer,
} from "@/lib/synthesizer-options";

const SYNTHESIZER_PREF_KEY = "apex.synthesizer";
const SYNTHESIZER_ID_KEY = "apex.synthesizer-id";
const SYNTH_STYLE_KEY = "apex.synth-style";
const ENSEMBLE_ID_KEY = "apex.ensemble-id";
const ECO_MODE_KEY = "apex.eco-mode";
const ENABLED_PROVIDERS_KEY = "apex.enabled-providers";
const FAVOR_CLAUDE_KEY = "apex.favor-claude-when-degraded";
const SELF_REFINE_KEY = "apex.self-refine";
const WEB_GROUNDING_KEY = "apex.web-grounding-mode";
const WEB_FETCH_DEPTH_KEY = "apex.web-fetch-depth";

type WebGroundingMode = "off" | "auto" | "always";
const COMPACT_MODE_KEY = "apex.compact-mode";

export type SubagentDisplayNode = {
  id: number;
  text: string;
  dependsOn: number[];
  status: string;
  answer: string;
  error?: string;
};

type ClassificationDisplay = {
  complexity: "simple" | "medium" | "complex";
  ambiguity: number;
  soloMode: boolean;
};

type WebGroundingState = {
  provider: "tavily" | "ddg";
  query: string;
  resultCount: number;
  reason: string;
  // Wave 21b — top URLs that were also fetched in full and appended
  // to the [WEB_CONTEXT] block. Empty when webFetchDepth=0 or fetches
  // all failed. UI shows "+N pages" next to the grounded badge.
  fetchedPages: Array<{ url: string; title: string | null; chars: number }>;
};

type State = {
  submitting: boolean;
  // Wave 20a — epoch-ms when "submit" was dispatched. Used to compute
  // the "Waiting for Claude · 12s" indicator on the synth panel. null
  // when not submitting or on history-view.
  submittingStartedAt: number | null;
  currentPrompt: string | null;
  selectedHistoryId: number | null;
  historyRefreshKey: number;
  activeProject: Project | null;
  notice: string | null;
  models: Record<Provider, PanelState>;
  synth: SynthState;
  subagentNodes: SubagentDisplayNode[] | null;
  attachments: AttachmentMeta[] | null;
  classification: ClassificationDisplay | null;
  webGrounding: WebGroundingState | null;
  // Wave 20b — per-provider self-reported "did you use the web context"
  // flag. Populated only when the request triggered grounding. Values:
  // true = provider emitted [grounded], false = [ungrounded], null =
  // provider ignored the ack instruction entirely. Used by ModelPanel
  // to show a small chip so silently-ignoring-the-context (Llama
  // failure) is visible at a glance.
  groundedByProvider: Partial<Record<Provider, boolean | null>>;
};

function initialPanel(): PanelState {
  return {
    status: "idle",
    tier: null,
    model: null,
    text: "",
    error: null,
    latencyMs: null,
    role: null,
    cached: false,
  };
}

function initialState(): State {
  return {
    submitting: false,
    submittingStartedAt: null,
    currentPrompt: null,
    selectedHistoryId: null,
    historyRefreshKey: 0,
    activeProject: null,
    notice: null,
    models: {
      claude: initialPanel(),
      openai: initialPanel(),
      llama: initialPanel(),
      gemini: initialPanel(),
      deepseek: initialPanel(),
    },
    synth: { status: "idle", text: "", error: null, latencyMs: null },
    subagentNodes: null,
    attachments: null,
    classification: null,
    webGrounding: null,
    groundedByProvider: {},
  };
}

function answerToPanel(a: HistoryAnswer): PanelState {
  return {
    status: a.error ? "error" : "done",
    tier: a.tier,
    model: a.model,
    text: a.text,
    error: a.error,
    latencyMs: a.latencyMs ?? null,
    role: a.role ?? null,
    cached: false,
  };
}

type Action =
  | { kind: "submit"; prompt: string }
  | { kind: "settle" }
  | { kind: "cancel-all" }
  | { kind: "sse"; event: SseEvent }
  | { kind: "new-chat" }
  | { kind: "load-history"; entry: HistoryEntry }
  | { kind: "history-refresh" }
  | { kind: "set-project"; project: Project | null }
  | { kind: "dismiss-notice" }
  | { kind: "set-notice"; notice: string };

function reducer(state: State, action: Action): State {
  switch (action.kind) {
    case "submit": {
      const fresh = initialState();
      return {
        ...fresh,
        submitting: true,
        submittingStartedAt: Date.now(),
        currentPrompt: action.prompt,
        selectedHistoryId: null,
        historyRefreshKey: state.historyRefreshKey,
        activeProject: state.activeProject,
        subagentNodes: null,
      };
    }
    case "settle":
      return { ...state, submitting: false, submittingStartedAt: null };
    case "cancel-all": {
      // Mark any in-flight panels as cancelled.
      const cancelled: Record<Provider, PanelState> = { ...state.models };
      for (const p of PROVIDERS) {
        const m = cancelled[p];
        if (m.status === "open" || m.status === "streaming") {
          cancelled[p] = { ...m, status: "error", error: "Cancelled" };
        }
      }
      const synth =
        state.synth.status === "open" || state.synth.status === "streaming"
          ? { ...state.synth, status: "error" as const, error: "Cancelled" }
          : state.synth;
      return {
        ...state,
        submitting: false,
        submittingStartedAt: null,
        models: cancelled,
        synth,
        notice: "Cancelled",
      };
    }
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
    case "dismiss-notice":
      return { ...state, notice: null };
    case "set-notice":
      return { ...state, notice: action.notice };
    case "load-history": {
      const e = action.entry;
      return {
        submitting: false,
        submittingStartedAt: null,
        currentPrompt: e.prompt,
        selectedHistoryId: e.id,
        historyRefreshKey: state.historyRefreshKey,
        activeProject: state.activeProject,
        notice: e.cancelled ? "This entry was cancelled mid-run." : null,
        classification: null,
        models: {
          claude: answerToPanel(e.answers.claude),
          openai: answerToPanel(e.answers.openai),
          llama: answerToPanel(e.answers.llama),
          gemini: answerToPanel(e.answers.gemini),
          deepseek: e.answers.deepseek
            ? answerToPanel(e.answers.deepseek)
            : initialPanel(),
        },
        synth: {
          status: e.synthError ? "error" : e.synthText ? "done" : "idle",
          text: e.synthText ?? "",
          error: e.synthError,
          latencyMs: null,
        },
        subagentNodes: (e.subagentTree as SubagentDisplayNode[] | null) ?? null,
        attachments: e.attachments,
        webGrounding: e.webGrounded
          ? {
              provider: "tavily",
              query: e.prompt,
              resultCount: 0,
              reason: "loaded from history (provider/result-count not stored)",
              fetchedPages: [],
            }
          : null,
        groundedByProvider: {},
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
                role: ev.role ?? null,
                cached: ev.cached ?? false,
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
                latencyMs: ev.latencyMs ?? null,
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
        case "warning":
          return { ...state, notice: ev.message };
        case "cancelled":
          return state; // Surface via cancel-all dispatched by client on AbortError.
        case "history-saved":
          return state;
        case "synth-open":
          return {
            ...state,
            synth: { status: "open", text: "", error: null, latencyMs: null },
          };
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
          return {
            ...state,
            synth: {
              ...state.synth,
              status: "done",
              latencyMs: ev.latencyMs ?? null,
            },
          };
        case "subagent-plan":
          return {
            ...state,
            subagentNodes: ev.nodes.map((n) => ({
              id: n.id,
              text: n.text,
              dependsOn: n.dependsOn,
              status: n.status,
              answer: n.answer,
              error: n.error,
            })),
          };
        case "subagent-update":
          return {
            ...state,
            subagentNodes: (state.subagentNodes ?? []).map((n) =>
              n.id === ev.id
                ? {
                    ...n,
                    status: ev.status,
                    answer: ev.answer ?? n.answer,
                    error: ev.error ?? n.error,
                  }
                : n,
            ),
          };
        case "classified":
          return {
            ...state,
            classification: {
              complexity: ev.complexity,
              ambiguity: ev.ambiguity,
              soloMode: ev.soloMode,
            },
          };
        case "follow-up-detected":
          // Wave 14 — server auto-detected a follow-up to a prior
          // history entry. For high confidence the parentId was
          // already threaded server-side; for medium we just surface
          // the suggestion. UI shows a chip in the notice slot.
          return {
            ...state,
            notice:
              ev.confidence === "high"
                ? `Auto-threaded from history #${ev.parentId}: "${ev.parentPromptSnippet}"`
                : `Looks like a follow-up to history #${ev.parentId}? Click "Continue thread" if so.`,
          };
        case "web-grounded":
          // Wave 17b — synth answer was grounded with fresh web data.
          // Surface as a badge on the synth panel + a brief notice.
          return {
            ...state,
            webGrounding: {
              provider: ev.provider,
              query: ev.query,
              resultCount: ev.resultCount,
              reason: ev.reason,
              fetchedPages: [],
            },
          };
        case "web-fetched":
          // Wave 21b — server auto-fetched top N URLs in full. Attach
          // to webGrounding state if grounding fired (web-grounded
          // arrives first per the API order). If no grounding state
          // yet, ignore — bare web-fetched without grounding shouldn't
          // happen, but be defensive.
          return state.webGrounding
            ? {
                ...state,
                webGrounding: {
                  ...state.webGrounding,
                  fetchedPages: ev.pages,
                },
              }
            : state;
        case "grounded-ack":
          // Wave 20b — per-provider self-report of whether it used the
          // web context. Diagnostic only; the actual behavior change
          // is in the reworded wrapper. UI shows a chip on ModelPanel.
          return {
            ...state,
            groundedByProvider: {
              ...state.groundedByProvider,
              [ev.provider]: ev.grounded,
            },
          };
        case "substituted":
          // Wave 20c — server is about to stream from a substitute
          // model (openai content-filter → gpt-oss-120b via Groq).
          // Mark the panel so the user sees the substitution before
          // the new stream's chunks arrive. The substitute model
          // replaces the original in state.models[provider].model.
          return {
            ...state,
            models: {
              ...state.models,
              [ev.provider]: {
                ...state.models[ev.provider],
                model: ev.substituteModel,
                substituted: { from: state.models[ev.provider].model ?? "?", reason: ev.reason },
                // The slot may have shown an error briefly before the
                // substitute kicked in — clear it.
                error: null,
                status: "streaming",
              },
            },
          };
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
  const [ensembleId, setEnsembleId] = useState<EnsembleId>(() => {
    if (typeof window === "undefined") return DEFAULT_ENSEMBLE_ID;
    const stored = window.localStorage.getItem(ENSEMBLE_ID_KEY);
    return stored && stored in ENSEMBLES
      ? (stored as EnsembleId)
      : DEFAULT_ENSEMBLE_ID;
  });
  const [ecoMode, setEcoMode] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(ECO_MODE_KEY) === "true";
  });
  // Wave 11: when on (default), auto-upgrade the synth to Claude Sonnet
  // when 2+ non-Claude providers are exhausted AND Claude is available
  // AND Eco mode is off. Stored client-side so the user can pin their
  // preference, sent with every /api/ask request.
  const [favorClaude, setFavorClaude] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    const stored = window.localStorage.getItem(FAVOR_CLAUDE_KEY);
    return stored == null ? true : stored === "true";
  });
  // Wave 12b: opt-in critique→revise pass on the synth. Default off
  // because it ~2× the synth latency.
  const [selfRefine, setSelfRefine] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(SELF_REFINE_KEY) === "true";
  });
  // Wave 17b — web grounding mode. Off | Auto | Always. Auto runs a
  // sync regex classifier server-side; Always grounds every query.
  const [webFetchDepth, setWebFetchDepth] = useState<number>(() => {
    if (typeof window === "undefined") return 0;
    const stored = window.localStorage.getItem(WEB_FETCH_DEPTH_KEY);
    const n = stored ? Number(stored) : 0;
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(3, Math.floor(n)));
  });
  const [webGroundingMode, setWebGroundingMode] = useState<WebGroundingMode>(() => {
    if (typeof window === "undefined") return "auto";
    const stored = window.localStorage.getItem(WEB_GROUNDING_KEY);
    return stored === "off" || stored === "always" ? stored : "auto";
  });
  const [enabledProviders, setEnabledProviders] = useState<Record<Provider, boolean>>(() => {
    const defaults: Record<Provider, boolean> = {
      claude: true,
      openai: true,
      llama: true,
      gemini: true,
      deepseek: true,
    };
    if (typeof window === "undefined") return defaults;
    const stored = window.localStorage.getItem(ENABLED_PROVIDERS_KEY);
    if (!stored) return defaults;
    try {
      const parsed = JSON.parse(stored) as Partial<Record<Provider, boolean>>;
      return { ...defaults, ...parsed };
    } catch {
      return defaults;
    }
  });
  const [continueThreadId, setContinueThreadId] = useState<number | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [compactMode, setCompactMode] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(COMPACT_MODE_KEY) === "true";
  });
  const [synthStyleId, setSynthStyleId] = useState<SynthStyleId>(() => {
    if (typeof window === "undefined") return DEFAULT_SYNTH_STYLE;
    const stored = window.localStorage.getItem(SYNTH_STYLE_KEY);
    return stored && stored in SYNTH_STYLES
      ? (stored as SynthStyleId)
      : DEFAULT_SYNTH_STYLE;
  });
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    window.localStorage.setItem(
      SYNTHESIZER_PREF_KEY,
      String(synthesizerEnabled),
    );
  }, [synthesizerEnabled]);

  useEffect(() => {
    window.localStorage.setItem(SYNTHESIZER_ID_KEY, synthesizerId);
  }, [synthesizerId]);

  useEffect(() => {
    window.localStorage.setItem(ENSEMBLE_ID_KEY, ensembleId);
  }, [ensembleId]);

  useEffect(() => {
    window.localStorage.setItem(ECO_MODE_KEY, String(ecoMode));
  }, [ecoMode]);

  useEffect(() => {
    window.localStorage.setItem(FAVOR_CLAUDE_KEY, String(favorClaude));
  }, [favorClaude]);

  useEffect(() => {
    window.localStorage.setItem(SELF_REFINE_KEY, String(selfRefine));
  }, [selfRefine]);

  useEffect(() => {
    window.localStorage.setItem(WEB_GROUNDING_KEY, webGroundingMode);
  }, [webGroundingMode]);

  useEffect(() => {
    window.localStorage.setItem(WEB_FETCH_DEPTH_KEY, String(webFetchDepth));
  }, [webFetchDepth]);

  useEffect(() => {
    window.localStorage.setItem(
      ENABLED_PROVIDERS_KEY,
      JSON.stringify(enabledProviders),
    );
  }, [enabledProviders]);

  useEffect(() => {
    window.localStorage.setItem(SYNTH_STYLE_KEY, synthStyleId);
  }, [synthStyleId]);

  useEffect(() => {
    window.localStorage.setItem(COMPACT_MODE_KEY, String(compactMode));
  }, [compactMode]);

  // Global keyboard shortcuts: ?, Alt+1..5.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inField =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;
      if (!inField && e.key === "?") {
        e.preventDefault();
        setShortcutsOpen(true);
      }
      if (e.altKey && /^[1-5]$/.test(e.key)) {
        const idx = Number(e.key) - 1;
        const target = ENSEMBLE_LIST[idx];
        if (target) {
          e.preventDefault();
          setEnsembleId(target.id);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Abort any in-flight request on unmount.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  function handleStop() {
    if (!abortRef.current) return;
    abortRef.current.abort();
    abortRef.current = null;
    dispatch({ kind: "cancel-all" });
  }

  // Esc to stop while streaming.
  useEffect(() => {
    if (!state.submitting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleStop();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.submitting]);

  // Wave 20a — 1s tick while submitting, so the "Waiting for X · Ns"
  // indicator on the synth panel updates in real time. The interval
  // only runs while at least one fan-out provider is still pending and
  // the synth hasn't started yet (otherwise "Synthesizing…" takes over).
  const [nowTick, setNowTick] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!state.submitting) return;
    setNowTick(Date.now());
    const id = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [state.submitting]);

  async function handleSubmit(
    prompt: string,
    files: File[] = [],
    opts: { forceFullFanout?: boolean; forceWebGrounding?: boolean } = {},
  ) {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    dispatch({ kind: "submit", prompt });
    const parentId = continueThreadId;
    setContinueThreadId(null);
    try {
      const useMultipart = files.length > 0;
      const init: RequestInit = {
        method: "POST",
        signal: controller.signal,
      };
      if (useMultipart) {
        const fd = new FormData();
        fd.set("prompt", prompt);
        if (state.activeProject?.id != null)
          fd.set("projectId", String(state.activeProject.id));
        fd.set("synthesize", String(synthesizerEnabled));
        if (synthesizerId) fd.set("synthesizerId", synthesizerId);
        if (ensembleId) fd.set("ensembleId", ensembleId);
        if (parentId != null) fd.set("parentId", String(parentId));
        fd.set("enabled", JSON.stringify(enabledProviders));
        fd.set("ecoMode", String(ecoMode));
        fd.set("favorClaudeWhenDegraded", String(favorClaude));
        fd.set("selfRefine", String(selfRefine));
        fd.set("styleId", synthStyleId);
        fd.set("webGroundingMode", webGroundingMode);
        fd.set("webFetchDepth", String(webFetchDepth));
        if (opts.forceFullFanout) fd.set("forceFullFanout", "true");
        if (opts.forceWebGrounding) fd.set("forceWebGrounding", "true");
        for (const f of files) fd.append("attachments", f, f.name);
        init.body = fd;
      } else {
        init.headers = { "Content-Type": "application/json" };
        init.body = JSON.stringify({
          prompt,
          projectId: state.activeProject?.id ?? null,
          synthesize: synthesizerEnabled,
          synthesizerId,
          ensembleId,
          parentId,
          enabled: enabledProviders,
          ecoMode,
          favorClaudeWhenDegraded: favorClaude,
          selfRefine,
          styleId: synthStyleId,
          forceFullFanout: opts.forceFullFanout === true,
          webGroundingMode,
          webFetchDepth,
          forceWebGrounding: opts.forceWebGrounding === true,
        });
      }
      const res = await fetch("/api/ask", init);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      for await (const event of parseSse(res)) {
        dispatch({ kind: "sse", event });
      }
    } catch (err) {
      if ((err as { name?: string }).name === "AbortError") {
        dispatch({ kind: "cancel-all" });
      } else {
        console.error(err);
        dispatch({
          kind: "set-notice",
          notice: "Connection interrupted. Click Submit to retry.",
        });
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      dispatch({ kind: "settle" });
      dispatch({ kind: "history-refresh" });
    }
  }

  async function handleResynthesize() {
    if (state.selectedHistoryId == null) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch("/api/resynthesize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: state.selectedHistoryId,
          synthesizerId,
        }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      for await (const event of parseSse(res)) {
        dispatch({ kind: "sse", event });
      }
    } catch (err) {
      if ((err as { name?: string }).name === "AbortError") {
        dispatch({ kind: "cancel-all" });
      } else {
        console.error(err);
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      dispatch({ kind: "history-refresh" });
    }
  }

  const viewingHistory = state.selectedHistoryId !== null;
  const synthInFlight =
    state.synth.status === "open" || state.synth.status === "streaming";
  // Wave 20a — when the synth hasn't started yet but the fan-out is
  // running, surface which provider(s) are the bottleneck. The synth
  // waits for ALL valid fan-out answers before composing; if Claude is
  // 15s+ behind everyone else, the user should see that.
  const waitingForFanOut: {
    pendingLabels: string[];
    elapsedSec: number;
  } | null =
    state.submitting &&
    !synthInFlight &&
    state.synth.status === "idle" &&
    state.submittingStartedAt !== null
      ? {
          pendingLabels: PROVIDERS.filter((p) => {
            const s = state.models[p].status;
            return s === "open" || s === "streaming";
          }).map((p) => PROVIDER_LABELS[p]),
          elapsedSec: Math.max(
            0,
            Math.round((nowTick - state.submittingStartedAt) / 1000),
          ),
        }
      : null;
  const showSynth =
    synthesizerEnabled ||
    state.synth.text ||
    state.synth.error ||
    viewingHistory;

  return (
    <div
      data-compact={compactMode ? "true" : "false"}
      className={`min-h-screen bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 flex ${
        compactMode ? "text-[13px]" : ""
      }`}
    >
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
              <EnsemblePicker active={ensembleId} onChange={setEnsembleId} />
            </div>
            <div className="flex items-center gap-3">
              <StatsChip refreshKey={state.historyRefreshKey} />
              <FeedbackButton />
              <p className="text-xs text-neutral-500 hidden md:block">
                Multi-LLM fan-out · Mixture of Agents
              </p>
              <button
                type="button"
                onClick={() => setCompactMode((v) => !v)}
                aria-label="Toggle compact mode"
                title={compactMode ? "Switch to comfortable" : "Switch to compact"}
                className="text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 text-sm leading-none w-8 h-8 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 transition flex items-center justify-center"
              >
                {compactMode ? "◰" : "◱"}
              </button>
              <button
                type="button"
                onClick={() => setShortcutsOpen(true)}
                aria-label="Keyboard shortcuts"
                className="text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 text-sm leading-none w-8 h-8 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 transition flex items-center justify-center"
                title="Keyboard shortcuts (?)"
              >
                ?
              </button>
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

          {continueThreadId != null && (
            <div className="rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50/60 dark:bg-indigo-950/40 px-3 py-1.5 text-xs flex items-center justify-between">
              <span className="text-indigo-900 dark:text-indigo-200">
                ↳ Continuing thread from entry #{continueThreadId}
              </span>
              <button
                type="button"
                onClick={() => setContinueThreadId(null)}
                className="text-indigo-600 dark:text-indigo-300 hover:text-indigo-900 dark:hover:text-indigo-100"
                aria-label="Cancel thread continuation"
              >
                ×
              </button>
            </div>
          )}
          <ChatInput
            onSubmit={handleSubmit}
            onStop={handleStop}
            streaming={state.submitting}
            synthesizerEnabled={synthesizerEnabled}
            onToggleSynthesizer={setSynthesizerEnabled}
          />

          {state.notice && (
            <div className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-xs flex items-center justify-between">
              <span className="text-amber-900 dark:text-amber-100">
                {state.notice}
              </span>
              <button
                type="button"
                onClick={() => dispatch({ kind: "dismiss-notice" })}
                aria-label="Dismiss notice"
                className="text-amber-700 dark:text-amber-300 hover:text-amber-900 dark:hover:text-amber-100 ml-3"
              >
                ×
              </button>
            </div>
          )}

          {state.classification && (
            <div
              className={`rounded-lg border px-3 py-2 text-xs flex items-center justify-between gap-3 ${
                state.classification.soloMode
                  ? "border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-200"
                  : "border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 text-neutral-700 dark:text-neutral-300"
              }`}
              aria-label="Prompt classification"
            >
              <span className="flex items-center gap-2 flex-wrap">
                <span className="font-medium">
                  {state.classification.soloMode
                    ? "Solo mode — Llama only"
                    : `Routing: ${state.classification.complexity}`}
                </span>
                {state.classification.soloMode && (
                  <span className="text-[10px] opacity-75">
                    skipped GPT / Gemini / Claude + synth to save cost
                  </span>
                )}
              </span>
              {state.classification.soloMode && state.currentPrompt && (
                <button
                  type="button"
                  onClick={() => {
                    if (state.currentPrompt) {
                      handleSubmit(state.currentPrompt, [], {
                        forceFullFanout: true,
                      });
                    }
                  }}
                  className="text-[11px] px-2 py-0.5 rounded-md bg-emerald-200 dark:bg-emerald-900/60 hover:bg-emerald-300 dark:hover:bg-emerald-900 text-emerald-950 dark:text-emerald-100 transition whitespace-nowrap"
                  aria-label="Run all four models on this prompt"
                  disabled={state.submitting}
                >
                  Run all 4
                </button>
              )}
            </div>
          )}

          {state.currentPrompt && (
            <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white/50 dark:bg-neutral-900/50 p-3 text-sm">
              <div className="text-[10px] uppercase tracking-wide text-neutral-500 mb-1">
                Question
              </div>
              <div className="whitespace-pre-wrap">{state.currentPrompt}</div>
              {state.attachments && state.attachments.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2 pt-2 border-t border-neutral-100 dark:border-neutral-800">
                  {state.attachments.map((a) => (
                    <a
                      key={a.sha256}
                      href={`/api/attachments/${a.sha256}`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-neutral-100 dark:bg-neutral-800 text-[11px] hover:bg-neutral-200 dark:hover:bg-neutral-700 transition"
                      title={`${a.name} (${a.mime}, ${(a.size / 1024).toFixed(0)}kb)`}
                    >
                      {a.kind === "image" ? (
                        <img
                          src={`/api/attachments/${a.sha256}`}
                          alt={a.name}
                          className="w-6 h-6 rounded object-cover"
                        />
                      ) : (
                        <span className="w-6 h-6 rounded bg-neutral-200 dark:bg-neutral-700 flex items-center justify-center text-[9px] uppercase">
                          {a.name.split(".").pop()?.slice(0, 3) ?? "?"}
                        </span>
                      )}
                      <span className="max-w-[150px] truncate">{a.name}</span>
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}

          {state.subagentNodes ? (
            <SubagentsPanel nodes={state.subagentNodes} />
          ) : (
            <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
              {PROVIDERS.map((p) => (
                <ModelPanel
                  key={p}
                  provider={p}
                  state={state.models[p]}
                  grounded={state.groundedByProvider[p]}
                />
              ))}
            </section>
          )}

          {showSynth && (
            <SynthesizerPanel
              state={state.synth}
              synthesizerLabel={findSynthesizer(synthesizerId).label}
              onResynthesize={viewingHistory ? handleResynthesize : undefined}
              resynthDisabled={synthInFlight}
              onContinueThread={
                viewingHistory && state.selectedHistoryId != null
                  ? () => setContinueThreadId(state.selectedHistoryId)
                  : undefined
              }
              waiting={waitingForFanOut}
              webGrounding={state.webGrounding}
              onRetryWithWebSearch={
                !viewingHistory &&
                !synthInFlight &&
                state.webGrounding == null &&
                state.currentPrompt
                  ? () =>
                      handleSubmit(state.currentPrompt as string, [], {
                        forceWebGrounding: true,
                      })
                  : undefined
              }
            />
          )}
        </div>
      </main>

      <ShortcutsHelp open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <Settings
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        synthesizerId={synthesizerId}
        onChangeSynthesizer={setSynthesizerId}
        ecoMode={ecoMode}
        onChangeEcoMode={setEcoMode}
        favorClaudeWhenDegraded={favorClaude}
        onChangeFavorClaude={setFavorClaude}
        selfRefine={selfRefine}
        onChangeSelfRefine={setSelfRefine}
        webGroundingMode={webGroundingMode}
        onChangeWebGroundingMode={setWebGroundingMode}
        webFetchDepth={webFetchDepth}
        onChangeWebFetchDepth={setWebFetchDepth}
        enabledProviders={enabledProviders}
        onToggleProvider={(p, enabled) =>
          setEnabledProviders((prev) => ({ ...prev, [p]: enabled }))
        }
        synthStyleId={synthStyleId}
        onChangeSynthStyle={setSynthStyleId}
      />
    </div>
  );
}
