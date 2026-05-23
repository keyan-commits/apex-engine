import { writeLog } from "./logs";

type Level = "debug" | "info" | "warn" | "error";

const ORDER: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };

const ENV_LEVEL = (process.env.APEX_LOG ?? "info").toLowerCase() as Level;
const THRESHOLD = ORDER[ENV_LEVEL] ?? ORDER.info;
const PERSIST_THRESHOLD = ORDER.warn;

function emit(level: Level, tag: string, msg: string, extra?: unknown) {
  if (ORDER[level] >= THRESHOLD) {
    const line = `[${level}] [${tag}] ${msg}`;
    const sink = level === "error" || level === "warn" ? console.error : console.log;
    if (extra !== undefined) sink(line, extra);
    else sink(line);
  }
  if (ORDER[level] >= PERSIST_THRESHOLD) {
    writeLog(level, tag, msg, extra);
  }
}

export function logger(tag: string) {
  return {
    debug: (msg: string, extra?: unknown) => emit("debug", tag, msg, extra),
    info: (msg: string, extra?: unknown) => emit("info", tag, msg, extra),
    warn: (msg: string, extra?: unknown) => emit("warn", tag, msg, extra),
    error: (msg: string, extra?: unknown) => emit("error", tag, msg, extra),
  };
}
