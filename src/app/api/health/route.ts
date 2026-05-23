import { streamText } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { google } from "@ai-sdk/google";
import { groq } from "@ai-sdk/groq";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { userFacingMessage } from "@/lib/errors";
import { logger } from "@/lib/log";
import { MODELS, PROVIDERS, type Provider } from "@/lib/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = logger("api/health");
const TTL_MS = 30_000;

const githubModels = createOpenAICompatible({
  name: "github-models",
  baseURL: "https://models.github.ai/inference",
  apiKey: process.env.GITHUB_MODELS_TOKEN,
});

type Status = {
  provider: Provider;
  model: string;
  ok: boolean;
  latencyMs: number;
  message: string;
};

type CachedResult = {
  ts: number;
  result: Status[];
};
let _cache: CachedResult | null = null;

async function pingProvider(provider: Provider): Promise<Status> {
  const model = MODELS[provider].primary;
  const start = Date.now();
  try {
    if (provider === "claude") {
      const result = query({
        prompt: "ping",
        options: {
          model,
          allowedTools: [],
          systemPrompt: {
            type: "preset",
            preset: "claude_code",
            append: "Reply with exactly the single word: PONG",
          },
        },
      });
      for await (const _msg of result) {
        if (_msg.type === "assistant") break; // first assistant chunk is enough
      }
      return { provider, model, ok: true, latencyMs: Date.now() - start, message: "ok" };
    }
    const m =
      provider === "openai"
        ? githubModels(model)
        : provider === "llama"
          ? groq(model)
          : google(model);
    const r = streamText({ model: m, prompt: "Reply with the single word PONG." });
    for await (const _ of r.textStream) break;
    return { provider, model, ok: true, latencyMs: Date.now() - start, message: "ok" };
  } catch (err) {
    log.warn(`health check failed for ${provider}`, err);
    return {
      provider,
      model,
      ok: false,
      latencyMs: Date.now() - start,
      message: userFacingMessage(err),
    };
  }
}

export async function GET() {
  if (_cache && Date.now() - _cache.ts < TTL_MS) {
    return Response.json({ cachedAt: _cache.ts, providers: _cache.result });
  }
  const result = await Promise.all(PROVIDERS.map(pingProvider));
  _cache = { ts: Date.now(), result };
  return Response.json({ cachedAt: _cache.ts, providers: result });
}
