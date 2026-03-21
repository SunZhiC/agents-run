import { existsSync } from "fs";
import { join, basename } from "path";
import { homedir } from "os";
import type { ProviderAdapter, ProviderName } from "./provider-types";
import type {
  Session,
  ConversationMessage,
  StreamResult,
  SessionMeta,
  SearchResult,
  SessionTokenUsage,
} from "./storage";
import * as storage from "./storage";
import { CodexAdapter } from "./codex-adapter";
import { GeminiAdapter } from "./gemini-adapter";

function createClaudeAdapter(claudeDir?: string): ProviderAdapter {
  storage.initStorage(claudeDir);

  return {
    name: "claude",

    async init() {
      await storage.loadStorage();
    },

    getWatchPaths() {
      const dir = storage.getClaudeDir();
      return {
        paths: [join(dir, "history.jsonl"), join(dir, "projects")],
        depth: 2,
      };
    },

    getSessions: () => storage.getSessions(),
    getProjects: () => storage.getProjects(),
    getConversation: (id) => storage.getConversation(id),
    getConversationStream: (id, offset) => storage.getConversationStream(id, offset),
    getSessionMeta: (id) => storage.getSessionMeta(id),
    searchConversations: (q) => storage.searchConversations(q),
    ownsSession: (id) => storage.hasSession(id),
    invalidateHistoryCache: () => storage.invalidateHistoryCache(),
    invalidateSessionMeta: (id) => storage.invalidateSessionMeta(id),
    addToFileIndex: (id, path) => storage.addToFileIndex(id, path),

    resolveSessionId(filePath: string): string | null {
      if (filePath.endsWith("history.jsonl")) return null;
      if (filePath.endsWith(".jsonl")) {
        return basename(filePath, ".jsonl");
      }
      return null;
    },
  };
}

class ProviderManager {
  private adapters: ProviderAdapter[] = [];

  async init(claudeDir?: string): Promise<void> {
    this.adapters = [];

    // 1. Claude adapter (always registered)
    this.adapters.push(createClaudeAdapter(claudeDir));

    // 2. Codex adapter (detect ~/.codex/sessions)
    const codexDir = join(homedir(), ".codex");
    if (existsSync(join(codexDir, "sessions"))) {
      this.adapters.push(new CodexAdapter(codexDir));
    }

    // 3. Gemini adapter (detect ~/.gemini/tmp)
    const geminiDir = join(homedir(), ".gemini");
    if (existsSync(join(geminiDir, "tmp"))) {
      this.adapters.push(new GeminiAdapter(geminiDir));
    }

    // 4. Initialize all adapters in parallel
    await Promise.all(this.adapters.map((a) => a.init()));
  }

  async getSessions(provider?: ProviderName): Promise<Session[]> {
    const targets = provider
      ? this.adapters.filter((a) => a.name === provider)
      : this.adapters;
    const results = await Promise.all(targets.map((a) => a.getSessions()));
    return results.flat().sort((a, b) => b.timestamp - a.timestamp);
  }

  async getProjects(provider?: ProviderName): Promise<string[]> {
    const targets = provider
      ? this.adapters.filter((a) => a.name === provider)
      : this.adapters;
    const results = await Promise.all(targets.map((a) => a.getProjects()));
    return [...new Set(results.flat())].sort();
  }

  async getConversation(sessionId: string): Promise<ConversationMessage[]> {
    const adapter = this.findAdapter(sessionId);
    return adapter ? adapter.getConversation(sessionId) : [];
  }

  async getConversationStream(sessionId: string, fromOffset: number): Promise<StreamResult> {
    const adapter = this.findAdapter(sessionId);
    return adapter
      ? adapter.getConversationStream(sessionId, fromOffset)
      : { messages: [], nextOffset: 0 };
  }

  async getSessionMeta(sessionId: string): Promise<SessionMeta> {
    const adapter = this.findAdapter(sessionId);
    return adapter
      ? adapter.getSessionMeta(sessionId)
      : {
          usage: {
            input_tokens: 0,
            output_tokens: 0,
            cache_write_5m_tokens: 0,
            cache_write_1h_tokens: 0,
            cache_read_tokens: 0,
          },
          subagents: [],
        };
  }

  async searchConversations(query: string, provider?: ProviderName): Promise<SearchResult[]> {
    const targets = provider
      ? this.adapters.filter((a) => a.name === provider)
      : this.adapters;
    const results = await Promise.all(targets.map((a) => a.searchConversations(query)));
    return results.flat().sort((a, b) => b.timestamp - a.timestamp);
  }

  getProviderForSession(sessionId: string): ProviderName | undefined {
    return this.findAdapter(sessionId)?.name;
  }

  private findAdapter(sessionId: string): ProviderAdapter | undefined {
    return this.adapters.find((a) => a.ownsSession(sessionId));
  }

  getAvailableProviders(): ProviderName[] {
    return this.adapters.map((a) => a.name);
  }

  getAdapters(): ProviderAdapter[] {
    return this.adapters;
  }
}

export const providerManager = new ProviderManager();
