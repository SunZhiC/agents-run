import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "@hono/node-server/serve-static";
import { streamSSE } from "hono/streaming";
import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";
import {
  getClaudeDir,
  getSubagentMap,
  getSubagentConversation,
  deleteSession,
  renameSession,
} from "./storage";
import type { ProviderName } from "./provider-types";
import { providerManager } from "./providers";
import {
  initWatcher,
  startWatcher,
  stopWatcher,
  addWatchTarget,
  emitHistoryChange,
  emitSessionChange,
  onHistoryChange,
  offHistoryChange,
  onSessionChange,
  offSessionChange,
} from "./watcher";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync, existsSync } from "fs";
import open from "open";
import type { Session } from "./storage";


const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function getWebDistPath(): string {
  const prodPath = join(__dirname, "web");
  if (existsSync(prodPath)) {
    return prodPath;
  }
  return join(__dirname, "..", "dist", "web");
}

export interface ServerOptions {
  port: number;
  claudeDir?: string;
  dev?: boolean;
  open?: boolean;
}

export function createServer(options: ServerOptions) {
  const { port, claudeDir, dev = false, open: shouldOpen = true } = options;

  const app = new Hono();

  if (dev) {
    app.use(
      "*",
      cors({
        origin: ["http://localhost:12000"],
        allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
        allowHeaders: ["Content-Type"],
      }),
    );
  }

  // === API Routes ===

  app.get("/api/providers", async (c) => {
    const providers = providerManager.getAvailableProviders();
    const sessions = await providerManager.getSessions();

    const result = providers.map((name) => ({
      name,
      sessionCount: sessions.filter((s) => s.provider === name).length,
    }));

    return c.json(result);
  });

  app.get("/api/sessions", async (c) => {
    const provider = c.req.query("provider") as ProviderName | undefined;
    const sessions = await providerManager.getSessions(provider);
    return c.json(sessions);
  });

  app.delete("/api/sessions/:id", async (c) => {
    const sessionId = c.req.param("id");
    const sessionProvider = providerManager.getProviderForSession(sessionId);
    if (sessionProvider && sessionProvider !== "claude") {
      return c.json({ error: "Delete not supported for this provider" }, 400);
    }
    const deleted = await deleteSession(sessionId);
    if (deleted) {
      return c.json({ success: true });
    }
    return c.json({ error: "Session not found" }, 404);
  });

  app.post("/api/sessions/:id/rename", async (c) => {
    const sessionId = c.req.param("id");
    const sessionProvider = providerManager.getProviderForSession(sessionId);
    if (sessionProvider && sessionProvider !== "claude") {
      return c.json({ error: "Rename not supported for this provider" }, 400);
    }
    try {
      const body = await c.req.json<{ name: string }>();
      const name = body?.name?.trim() ?? "";

      if (!name) {
        return c.json({ error: "Name cannot be empty" }, 400);
      }
      if (name.length > 200) {
        return c.json({ error: "Name too long (max 200 characters)" }, 400);
      }

      const success = await renameSession(sessionId, name);
      if (success) {
        return c.json({ success: true });
      }
      return c.json({ error: "Session not found" }, 404);
    } catch {
      return c.json({ error: "Invalid request body" }, 400);
    }
  });

  app.get("/api/projects", async (c) => {
    const projects = await providerManager.getProjects();
    return c.json(projects);
  });

  app.get("/api/sessions/stream", async (c) => {
    const provider = c.req.query("provider") as ProviderName | undefined;

    return streamSSE(c, async (stream) => {
      let isConnected = true;
      const knownSessions = new Map<string, string>();

      const sessionSignature = (session: Session): string =>
        JSON.stringify({
          display: session.display,
          timestamp: session.timestamp,
          project: session.project,
          projectName: session.projectName,
          messageCount: session.messageCount,
          model: session.model ?? null,
          provider: session.provider,
          surface: session.surface ?? null,
        });

      const cleanup = () => {
        isConnected = false;
        offHistoryChange(handleHistoryChange);
        offSessionChange(handleSessionListChange);
      };

      const syncSessions = async () => {
        if (!isConnected) {
          return;
        }
        try {
          const sessions = await providerManager.getSessions(provider);
          const nextKnownSessions = new Map<string, string>();
          const newOrUpdated = sessions.filter((s) => {
            const signature = sessionSignature(s);
            nextKnownSessions.set(s.id, signature);
            return knownSessions.get(s.id) !== signature;
          });
          const removedSessionIds = [...knownSessions.keys()].filter(
            (sessionId) => !nextKnownSessions.has(sessionId),
          );

          knownSessions.clear();
          for (const [sessionId, signature] of nextKnownSessions) {
            knownSessions.set(sessionId, signature);
          }

          if (newOrUpdated.length > 0) {
            await stream.writeSSE({
              event: "sessionsUpdate",
              data: JSON.stringify(newOrUpdated),
            });
          }
          if (removedSessionIds.length > 0) {
            await stream.writeSSE({
              event: "sessionsRemove",
              data: JSON.stringify(removedSessionIds),
            });
          }
        } catch {
          cleanup();
        }
      };

      const handleHistoryChange = async () => {
        await syncSessions();
      };

      const handleSessionListChange = async () => {
        await syncSessions();
      };

      onHistoryChange(handleHistoryChange);
      onSessionChange(handleSessionListChange);
      c.req.raw.signal.addEventListener("abort", cleanup);

      try {
        const sessions = await providerManager.getSessions(provider);
        for (const s of sessions) {
          knownSessions.set(s.id, sessionSignature(s));
        }

        await stream.writeSSE({
          event: "sessions",
          data: JSON.stringify(sessions),
        });

        while (isConnected) {
          await stream.writeSSE({
            event: "heartbeat",
            data: JSON.stringify({ timestamp: Date.now() }),
          });
          await stream.sleep(30000);
        }
      } catch {
        // Connection closed
      } finally {
        cleanup();
      }
    });
  });

  app.get("/api/conversation/:id", async (c) => {
    const sessionId = c.req.param("id");
    const messages = await providerManager.getConversation(sessionId);
    return c.json(messages);
  });

  app.get("/api/conversation/:id/subagents", async (c) => {
    const sessionId = c.req.param("id");
    const sessionProvider = providerManager.getProviderForSession(sessionId);
    if (sessionProvider && sessionProvider !== "claude") {
      return c.json([]);
    }
    const infos = await getSubagentMap(sessionId);
    return c.json(infos);
  });

  app.get("/api/conversation/:id/subagent/:agentId", async (c) => {
    const sessionId = c.req.param("id");
    const sessionProvider = providerManager.getProviderForSession(sessionId);
    if (sessionProvider && sessionProvider !== "claude") {
      return c.json([]);
    }
    const agentId = c.req.param("agentId");
    const messages = await getSubagentConversation(sessionId, agentId);
    return c.json(messages);
  });

  app.get("/api/conversation/:id/meta", async (c) => {
    const sessionId = c.req.param("id");
    const meta = await providerManager.getSessionMeta(sessionId);
    return c.json(meta);
  });

  app.get("/api/conversation/:id/usage", async (c) => {
    const sessionId = c.req.param("id");
    const meta = await providerManager.getSessionMeta(sessionId);
    return c.json(meta.usage);
  });

  app.get("/api/conversation/:id/stream", async (c) => {
    const sessionId = c.req.param("id");
    const offsetParam = c.req.query("offset");
    let offset = offsetParam ? parseInt(offsetParam, 10) : 0;

    return streamSSE(c, async (stream) => {
      let isConnected = true;

      const cleanup = () => {
        isConnected = false;
        offSessionChange(handleSessionChange);
      };

      const handleSessionChange = async (changedSessionId: string) => {
        if (changedSessionId !== sessionId || !isConnected) {
          return;
        }

        const { messages: newMessages, nextOffset: newOffset } =
          await providerManager.getConversationStream(sessionId, offset);
        offset = newOffset;

        if (newMessages.length > 0) {
          try {
            await stream.writeSSE({
              event: "messages",
              data: JSON.stringify({ messages: newMessages, nextOffset: newOffset }),
            });
          } catch {
            cleanup();
          }
        }
      };

      onSessionChange(handleSessionChange);
      c.req.raw.signal.addEventListener("abort", cleanup);

      try {
        const { messages, nextOffset } = await providerManager.getConversationStream(
          sessionId,
          offset,
        );
        offset = nextOffset;

        await stream.writeSSE({
          event: "messages",
          data: JSON.stringify({ messages, nextOffset }),
        });

        while (isConnected) {
          await stream.writeSSE({
            event: "heartbeat",
            data: JSON.stringify({ timestamp: Date.now() }),
          });
          await stream.sleep(30000);
        }
      } catch {
        // Connection closed
      } finally {
        cleanup();
      }
    });
  });

  app.post("/api/search", async (c) => {
    const body = await c.req.json<{ query: string; provider?: ProviderName }>();
    const query = body?.query?.trim() ?? "";

    if (!query) {
      return c.json({ results: [] });
    }

    const results = await providerManager.searchConversations(query, body?.provider);
    return c.json({ results });
  });

  // === Static files ===

  const webDistPath = getWebDistPath();

  app.use("/*", serveStatic({ root: webDistPath }));

  app.get("/*", async (c) => {
    const indexPath = join(webDistPath, "index.html");
    try {
      const html = readFileSync(indexPath, "utf-8");
      return c.html(html);
    } catch {
      return c.text("UI not found. Run 'pnpm build' first.", 404);
    }
  });

  let httpServer: ServerType | null = null;

  return {
    app,
    port,
    start: async () => {
      // 1. Initialize all providers (includes Claude storage)
      await providerManager.init(claudeDir);

      // 2. Setup Claude watcher (existing logic)
      initWatcher(getClaudeDir());
      startWatcher();

      const claudeAdapter = providerManager.getAdapters().find((a) => a.name === "claude")!;

      onHistoryChange(() => {
        claudeAdapter.invalidateHistoryCache();
      });

      onSessionChange((sessionId: string, filePath: string) => {
        claudeAdapter.addToFileIndex(sessionId, filePath);
        claudeAdapter.invalidateSessionMeta(sessionId);
      });

      // 3. Setup watchers for non-Claude providers
      for (const adapter of providerManager.getAdapters()) {
        if (adapter.name === "claude") continue;

        const { paths, depth } = adapter.getWatchPaths();
        addWatchTarget(paths, depth, (filePath) => {
          const sessionId = adapter.resolveSessionId(filePath);

          if (sessionId) {
            adapter.addToFileIndex(sessionId, filePath);
            adapter.invalidateSessionMeta(sessionId);
            emitSessionChange(sessionId, filePath);
          } else {
            adapter.invalidateHistoryCache();
            emitHistoryChange();
          }
        });
      }

      // 4. Start HTTP server
      const openUrl = `http://localhost:${dev ? 12000 : port}/`;

      console.log(`\n  Agents Run is running at ${openUrl}\n`);
      if (!dev && shouldOpen) {
        open(openUrl).catch(console.error);
      }

      httpServer = serve({
        fetch: app.fetch,
        port,
      });

      return httpServer;
    },
    stop: () => {
      stopWatcher();
      if (httpServer) {
        httpServer.close();
      }
    },
  };
}
