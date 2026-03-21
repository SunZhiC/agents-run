# Multi-Provider Implementation Guide

> 基于实际数据验证后的逐文件实现规格。每个文件给出完整代码骨架、关键映射表和边界处理。

---

## 0. 数据源矩阵

基于实际 `~/.codex/` 和 `~/.gemini/` 数据验证。

| 维度 | Claude Code | Codex（CLI + Desktop 合并） | Gemini CLI |
|------|-------------|---------------------------|------------|
| **Provider ID** | `claude` | `codex` | `gemini` |
| **Surface** | `cli` | `cli` / `tui` / `app` / `exec`（从 `session_meta.payload.originator` 解析） | `cli` |
| **来源目录** | `~/.claude/` | `~/.codex/`（CLI、TUI、Desktop、Exec 共用） |  `~/.gemini/` |
| **会话索引** | `history.jsonl` | `session_index.jsonl`（仅 19/282 条有 thread_name） | 无索引文件，扫描 `tmp/*/chats/session-*.json` |
| **会话文件格式** | JSONL | JSONL | **标准 JSON**（非 JSONL） |
| **会话文件位置** | `projects/<encoded-path>/<id>.jsonl` | `sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl` | `tmp/<project-slug>/chats/session-*.json` |
| **Session ID 来源** | 文件名 = session ID | 首行 `session_meta.payload.id`（UUID） | JSON 内 `sessionId` 字段（UUID） |
| **Originator 区分** | 无（全部 Claude Code） | `session_meta.payload.originator`：`codex_cli_rs` / `codex-tui` / `Codex Desktop` / `codex_exec` | 无 |
| **用户消息角色** | `type: "user"` | `payload.role: "user"`（真正的用户输入） | `type: "user"` |
| **系统/开发者指令** | 不在消息流中 | `payload.role: "developer"`（权限、协作模式等系统指令，**需跳过**） | 不在消息流中 |
| **助手消息** | `type: "assistant"` | `payload.role: "assistant"` | `type: "gemini"` |
| **Token 数据** | 每条 assistant 有 `message.usage` | **无**（JSONL 中无 token 数据） | 每条 gemini 有 `tokens: {input, output, cached, thoughts, tool, total}` |
| **Thinking/Reasoning** | `ContentBlock.type: "thinking"` | `payload.type: "reasoning"`（内容加密不可读） | `thoughts: [{subject, description, timestamp}]` |
| **工具调用** | `ContentBlock.type: "tool_use"` | `payload.type: "function_call"` | gemini 消息内 `toolCalls[]`（tool_use + tool_result 内嵌同一消息） |
| **子代理** | `type: "progress"` + `agentId` | 无 | 无 |
| **支持 Rename** | 是（修改 `history.jsonl`） | **否** | **否** |
| **支持 Delete** | 是（修改 `history.jsonl`） | **否** | **否** |
| **支持 Resume** | `claude --resume <id>` | `codex resume <id>` | **不支持** |
| **Stream offset 语义** | 字节偏移（JSONL byte-offset） | 字节偏移（JSONL byte-offset） | **消息索引**（JSON 需整体重新解析） |
| **Watch 触发策略** | `history.jsonl` 变更 → 刷新列表；`projects/**/*.jsonl` 变更 → 提取 sessionId → 刷新会话 | `session_index.jsonl` 变更 → 刷新列表；`sessions/**/*.jsonl` 变更 → reverseFileIndex 反查 sessionId → 刷新会话 | `projects.json` 变更 → 刷新项目映射；`tmp/**/*.json` 变更 → reverseFileIndex 反查 sessionId → 刷新会话 |
| **数据量** | 视用户而定 | 282 文件，377 MB | 51 文件，~65 MB |

### 关键决策：Codex CLI 与 Codex Desktop 合并为一个 Provider

实际验证发现 `~/.codex/` 目录被 4 种 originator 共用：

| originator | 数量 | 来源 |
|-----------|------|------|
| `codex_cli_rs` | 217 | Codex CLI (Rust) |
| `codex-tui` | 26 | Codex TUI |
| `Codex Desktop` | 24 | Codex App (Electron) |
| `codex_exec` | 16 | Codex Exec |

**决策**：合并为单个 `codex` provider。理由：
1. 共用同一个 `~/.codex/` 数据目录和 `session_index.jsonl`
2. JSONL 格式完全相同
3. 在 session 列表中通过 originator 子标签区分来源（如 `[CLI]` `[Desktop]`）即可

### 关键决策：developer 角色消息的处理

实际验证发现 Codex 的 `payload.role: "developer"` 消息包含的是**系统指令**（权限配置 `<permissions instructions>`、协作模式 `<collaboration_mode>` 等），而非用户输入。真正的用户输入是 `payload.role: "user"`。

**决策**：`developer` 角色消息**跳过**，不显示在对话中。只有 `role: "user"` 才映射为 `ConversationMessage { type: "user" }`。

### 关键决策：provider + surface 二层建模

Schema 预留 `surface` 字段表示入口/客户端类型，与 `provider` 解耦：

| provider | surface | 识别方式 |
|----------|---------|----------|
| `claude` | `cli` | 固定（当前只有 CLI 入口） |
| `codex` | `cli` | `originator === "codex_cli_rs"` |
| `codex` | `tui` | `originator === "codex-tui"` |
| `codex` | `app` | `originator === "Codex Desktop"` |
| `codex` | `exec` | `originator === "codex_exec"` |
| `gemini` | `cli` | 固定 |

**好处**：即便现在不在 UI 上暴露 surface 筛选，schema 有这层后，将来不需要从 `provider` 里拆。originator → surface 的映射表定义在 Codex adapter 中。

**当前 UI 行为**：session 列表的 CLI Provider 徽章默认只显示 `provider`，但 Codex session 可在徽章旁追加小标签 `[Desktop]`（当 `surface !== "cli"` 时）。

---

## 实施顺序

1. `api/provider-types.ts` — 接口定义
2. `api/storage.ts` — Session 加 `provider` 字段 + 导出 `hasSession()`
3. `api/codex-adapter.ts` — Codex 适配器
4. `api/gemini-adapter.ts` — Gemini CLI 适配器
5. `api/providers.ts` — Provider Manager 聚合层
6. `api/watcher.ts` — 多目录监听
7. `api/server.ts` — API 层接入（初始化顺序是关键）
8. `web/utils.ts` — Provider 规则 + CLI 徽章
9. `web/app.tsx` — Provider 筛选 + Resume 命令
10. `web/components/session-list.tsx` — CLI Provider 徽章 + 搜索 provider 透传
11. `web/components/session-view.tsx` — Token 显示适配
12. `web/components/markdown-export.tsx` — 导出角色名适配
13. `web/components/message-block.tsx` — Codex 工具名映射（exec_command 等）

---

## 1. `api/provider-types.ts`（新建）

```typescript
import type {
  Session,
  ConversationMessage,
  StreamResult,
  SessionMeta,
  SearchResult,
} from "./storage";

export type ProviderName = "claude" | "codex" | "gemini";

export interface ProviderAdapter {
  readonly name: ProviderName;

  init(): Promise<void>;
  getWatchPaths(): { paths: string[]; depth: number };
  getSessions(): Promise<Session[]>;
  getProjects(): Promise<string[]>;
  getConversation(sessionId: string): Promise<ConversationMessage[]>;
  getConversationStream(sessionId: string, fromOffset: number): Promise<StreamResult>;
  getSessionMeta(sessionId: string): Promise<SessionMeta>;
  searchConversations(query: string): Promise<SearchResult[]>;
  ownsSession(sessionId: string): boolean;
  invalidateHistoryCache(): void;
  invalidateSessionMeta(sessionId: string): void;
  addToFileIndex(sessionId: string, filePath: string): void;

  /**
   * 从文件路径反查 sessionId。
   * watcher 捕获文件变更时调用，用于触发 SSE session 更新。
   * 返回 null 表示该文件不属于此 adapter 的 session 文件（可能是索引文件等）。
   */
  resolveSessionId(filePath: string): string | null;
}
```

---

## 2. `api/storage.ts`（修改）

### 变更 1：Session 接口加 `provider` 字段

```diff
 export interface Session {
   id: string;
   display: string;
   timestamp: number;
   project: string;
   projectName: string;
   messageCount: number;
   model?: string;
+  provider: "claude" | "codex" | "gemini";
+  surface?: "cli" | "tui" | "app" | "exec";  // 入口类型，Codex 从 originator 解析
 }
```

### 变更 2：`getSessions()` 注入 `provider: "claude"`

```diff
 return {
   id: sessionId,
   display: entry.display,
   timestamp: entry.timestamp,
   project: entry.project,
   projectName: getProjectName(entry.project),
   messageCount,
   model,
+  provider: "claude",
 };
```

### 变更 3：新增 `hasSession()` 导出

```typescript
export function hasSession(sessionId: string): boolean {
  return fileIndex.has(sessionId);
}
```

---

## 3. `api/codex-adapter.ts`（新建）

### 3.1 数据源路径

```
~/.codex/
├── session_index.jsonl          # 19 条，每行 {id, thread_name, updated_at}
├── history.jsonl                # 每个 prompt 一行 {session_id, ts, text}
└── sessions/
    └── YYYY/MM/DD/
        └── rollout-<ISO-timestamp>-<UUID>.jsonl   # 282 个文件
```

### 3.2 类结构

```typescript
class CodexAdapter implements ProviderAdapter {
  readonly name = "codex" as const;

  private codexDir: string;
  // session_index.jsonl 数据
  private sessionIndex = new Map<string, { threadName: string; updatedAt: string }>();
  // sessionId → filePath
  private fileIndex = new Map<string, string>();
  // filePath → sessionId（供 watcher 反查）
  private reverseFileIndex = new Map<string, string>();
  // 缓存的 session 元数据
  private sessionMetaCache = new Map<string, CodexSessionMeta>();
  // history 缓存
  private historyCache: { sessionId: string; ts: string; text: string }[] | null = null;

  // originator → surface 映射
  private static ORIGINATOR_TO_SURFACE: Record<string, string> = {
    "codex_cli_rs": "cli",
    "codex-tui": "tui",
    "Codex Desktop": "app",
    "codex_exec": "exec",
  };

  constructor(codexDir: string) { this.codexDir = codexDir; }
}
```

### 3.3 init() 实现

```typescript
async init(): Promise<void> {
  // 1. 解析 session_index.jsonl
  const indexPath = join(this.codexDir, "session_index.jsonl");
  try {
    const content = await readFile(indexPath, "utf-8");
    for (const line of content.trim().split("\n").filter(Boolean)) {
      const entry = JSON.parse(line);
      this.sessionIndex.set(entry.id, {
        threadName: entry.thread_name,
        updatedAt: entry.updated_at,
      });
    }
  } catch { /* file may not exist */ }

  // 2. 递归扫描 sessions/ 找所有 .jsonl 文件
  //    并行读取首行获取 session_meta
  const sessionsDir = join(this.codexDir, "sessions");
  const files = await findJsonlFilesRecursive(sessionsDir);

  // 并行读首行（限制并发 50）
  await parallelMap(files, 50, async (filePath) => {
    const firstLine = await readFirstLine(filePath);
    if (!firstLine) return;
    try {
      const meta = JSON.parse(firstLine);
      if (meta.type !== "session_meta") return;
      const sessionId = meta.payload.id;
      this.fileIndex.set(sessionId, filePath);
      this.reverseFileIndex.set(filePath, sessionId);
      // 缓存元数据
      const originator = meta.payload.originator ?? "";
      this.sessionMetaCache.set(sessionId, {
        cwd: meta.payload.cwd ?? "",
        originator,
        surface: CodexAdapter.ORIGINATOR_TO_SURFACE[originator] ?? "cli",
        timestamp: Date.parse(meta.payload.timestamp ?? meta.timestamp),
        // firstPrompt 和 messageCount 需要扫描更多行
      });
    } catch { /* skip malformed */ }
  });

  // 3. 对每个 session 读前 ~20 行，获取首条 user 消息和 messageCount
  await parallelMap([...this.fileIndex.entries()], 50, async ([sessionId, filePath]) => {
    const cached = this.sessionMetaCache.get(sessionId);
    if (!cached) return;
    const { firstPrompt, messageCount } = await this.scanSessionHead(filePath);
    cached.firstPrompt = firstPrompt;
    cached.messageCount = messageCount;
  });
}
```

**`readFirstLine(filePath)`** — 用 `createReadStream` + `readline` 只读第一行，O(1) 内存。

**`scanSessionHead(filePath)`** — 读整个文件统计 messageCount，同时找首条 `role: "user"` 的 `input_text` 作为 firstPrompt。

### 3.4 getSessions()

```typescript
async getSessions(): Promise<Session[]> {
  const sessions: Session[] = [];

  for (const [sessionId, filePath] of this.fileIndex) {
    const indexEntry = this.sessionIndex.get(sessionId);
    const meta = this.sessionMetaCache.get(sessionId)!;

    sessions.push({
      id: sessionId,
      display: indexEntry?.threadName
        ?? meta.firstPrompt?.slice(0, 100)
        ?? "Untitled",
      timestamp: indexEntry
        ? Date.parse(indexEntry.updatedAt)
        : meta.timestamp,
      project: meta.cwd,
      projectName: getProjectName(meta.cwd),
      messageCount: meta.messageCount ?? 0,
      model: undefined,  // Codex JSONL 中不暴露模型名
      provider: "codex",
      surface: meta.surface as Session["surface"],  // "cli" | "tui" | "app" | "exec"
    });
  }

  return sessions.sort((a, b) => b.timestamp - a.timestamp);
}
```

### 3.5 getConversation() — 消息映射表

#### UUID 生成策略

**问题**：Codex JSONL 的 response_item 没有自带的 uuid 字段，但前端流式追加时用 `message.uuid` 去重（见 `session-view.tsx:103`）。没有稳定 uuid 会导致重复渲染或消息丢失。

**方案**：Adapter 在转换时为每条消息生成确定性 uuid：
```typescript
// 基于 timestamp + line_index 生成确定性 uuid
// 相同文件、相同行总是产生相同 uuid，保证幂等
const uuid = `codex-${sessionId}-${lineIndex}`;
```

每条转换后的 `ConversationMessage` 必须设置 `uuid` 字段。

逐行读取 JSONL，按以下规则转换：

| 原始行 | 条件 | 转换为 |
|--------|------|--------|
| `type: "session_meta"` | — | **跳过** |
| `type: "event_msg"` | — | **跳过** |
| `type: "turn_context"` | — | **跳过** |
| `type: "compacted"` | — | **跳过** |
| `type: "response_item"`, `payload.role: "developer"` | 系统指令 | **跳过**（包含 `<permissions>`, `<collaboration_mode>` 等系统配置） |
| `type: "response_item"`, `payload.role: "user"` | 用户输入 | `ConversationMessage { type: "user" }` |
| `type: "response_item"`, `payload.role: "assistant"` | 助手回复 | `ConversationMessage { type: "assistant" }` |
| `type: "response_item"`, `payload.type: "reasoning"` | 思考（加密） | `ConversationMessage { type: "assistant" }` 包含 thinking block（占位符） |
| `type: "response_item"`, `payload.type: "function_call"` | 工具调用 | `ConversationMessage { type: "assistant" }` 包含 tool_use block |
| `type: "response_item"`, `payload.type: "function_call_output"` | 工具结果 | `ConversationMessage { type: "user" }` 包含 tool_result block |

#### Content Block 映射

**用户消息** (`role: "user"`)：
```typescript
const textParts = payload.content
  .filter(c => c.type === "input_text")
  .map(c => c.text);
message.content = textParts.join("\n");
```

**助手消息** (`role: "assistant"`)：
```typescript
const blocks: ContentBlock[] = payload.content.map(c => {
  if (c.type === "output_text") return { type: "text", text: c.text };
  return null;
}).filter(Boolean);
message.content = blocks;
```

**Reasoning**（`payload.type: "reasoning"`）：
```typescript
// 实际数据：summary=[], content=null, encrypted_content=加密字符串
// 思考内容不可读，只能显示占位符
const thinkingText = payload.summary?.[0]?.text ?? "[Reasoning]";
→ { type: "assistant", message.content: [{ type: "thinking", thinking: thinkingText }] }
```

**Function Call**（`payload.type: "function_call"`）：
```typescript
// payload: { type, name, arguments (JSON string), call_id }
→ { type: "assistant", message.content: [{
    type: "tool_use",
    id: payload.call_id,
    name: payload.name,
    input: JSON.parse(payload.arguments),
  }] }
```

**Function Call Output**（`payload.type: "function_call_output"`）：
```typescript
// payload: { type, call_id, output (string) }
→ { type: "user", message.content: [{
    type: "tool_result",
    tool_use_id: payload.call_id,
    content: payload.output,
  }] }
```

### 3.6 getConversationStream()

与 Claude 相同的 JSONL byte-offset 流式读取。可以复用 `storage.ts` 中的 `createReadStream` + `readline` 逻辑，只是消息转换函数不同。

### 3.7 getSessionMeta()

```typescript
async getSessionMeta(sessionId: string): Promise<SessionMeta> {
  // Codex JSONL 中无逐条 token 数据
  return {
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      cache_write_5m_tokens: 0,
      cache_write_1h_tokens: 0,
      cache_read_tokens: 0,
    },
    subagents: [], // Codex 无子代理概念
  };
}
```

### 3.8 resolveSessionId()

```typescript
resolveSessionId(filePath: string): string | null {
  // session_index.jsonl 变更 → 返回 null（是列表刷新，不是单个 session 更新）
  if (filePath.endsWith("session_index.jsonl")) return null;
  // sessions/**/*.jsonl → 从 reverseFileIndex 反查
  return this.reverseFileIndex.get(filePath) ?? null;
}
```

### 3.9 Watch 配置

```typescript
getWatchPaths() {
  return {
    paths: [
      join(this.codexDir, "session_index.jsonl"),
      join(this.codexDir, "sessions"),
    ],
    depth: 4, // sessions/YYYY/MM/DD/file.jsonl = 4 层
  };
}
```

### 3.10 invalidateHistoryCache() 和新 session 文件处理

```typescript
invalidateHistoryCache(): void {
  // 重新加载 session_index.jsonl
  this.historyCache = null;
  // 注意：新 session 文件可能尚未在 fileIndex 中
  // 下次 getSessions() 时需要检查是否有新文件
}

addToFileIndex(sessionId: string, filePath: string): void {
  this.fileIndex.set(sessionId, filePath);
  this.reverseFileIndex.set(filePath, sessionId);
}
```

---

## 4. `api/gemini-adapter.ts`（新建）

### 4.1 数据源路径

```
~/.gemini/
├── projects.json                # {projects: {"/abs/path": "slug", ...}}
└── tmp/
    └── <project-slug>/
        └── chats/
            └── session-YYYY-MMDDTHH-MM-<uuid>.json   # 标准 JSON，51 个文件
```

### 4.2 类结构

```typescript
class GeminiAdapter implements ProviderAdapter {
  readonly name = "gemini" as const;

  private geminiDir: string;
  // slug → absolutePath
  private projectMap = new Map<string, string>();
  // sessionId → filePath
  private fileIndex = new Map<string, string>();
  // filePath → sessionId（供 watcher 反查）
  private reverseFileIndex = new Map<string, string>();
  // sessionId → slug（从文件路径提取）
  private fileSlugMap = new Map<string, string>();
  // 缓存的 session 元数据
  private sessionCache = new Map<string, GeminiSessionMeta>();

  constructor(geminiDir: string) { this.geminiDir = geminiDir; }
}
```

### 4.3 init()

```typescript
async init(): Promise<void> {
  // 1. 解析 projects.json → projectMap
  const projectsPath = join(this.geminiDir, "projects.json");
  try {
    const data = JSON.parse(await readFile(projectsPath, "utf-8"));
    // data.projects 是 {"/abs/path": "slug"} 格式，需要反转
    for (const [absPath, slug] of Object.entries(data.projects)) {
      this.projectMap.set(slug as string, absPath);
    }
  } catch { /* file may not exist */ }

  // 2. 扫描 tmp/*/chats/session-*.json
  const tmpDir = join(this.geminiDir, "tmp");
  const slugDirs = await readdir(tmpDir, { withFileTypes: true });

  await parallelMap(
    slugDirs.filter(d => d.isDirectory()),
    20,
    async (slugDir) => {
      const chatsDir = join(tmpDir, slugDir.name, "chats");
      let chatFiles: string[];
      try {
        chatFiles = (await readdir(chatsDir))
          .filter(f => f.startsWith("session-") && f.endsWith(".json"));
      } catch { return; }

      for (const file of chatFiles) {
        const filePath = join(chatsDir, file);
        try {
          const raw = await readFile(filePath, "utf-8");
          const data = JSON.parse(raw);
          const sessionId = data.sessionId;
          if (!sessionId) continue;

          this.fileIndex.set(sessionId, filePath);
          this.reverseFileIndex.set(filePath, sessionId);
          this.fileSlugMap.set(sessionId, slugDir.name);

          // 缓存元数据（不缓存 messages 本身）
          const messages = data.messages ?? [];
          const firstUser = messages.find((m: any) => m.type === "user");
          const firstGemini = messages.find((m: any) => m.type === "gemini");

          this.sessionCache.set(sessionId, {
            startTime: data.startTime,
            lastUpdated: data.lastUpdated,
            summary: data.summary,
            firstUserMessage: firstUser?.content?.[0]?.text,
            messageCount: messages.filter(
              (m: any) => m.type === "user" || m.type === "gemini"
            ).length,
            model: firstGemini?.model,
          });
        } catch { /* skip malformed */ }
      }
    }
  );
}
```

### 4.4 getSessions()

```typescript
async getSessions(): Promise<Session[]> {
  const sessions: Session[] = [];

  for (const [sessionId, cached] of this.sessionCache) {
    const slug = this.fileSlugMap.get(sessionId);
    const projectPath = slug ? (this.projectMap.get(slug) ?? "") : "";

    sessions.push({
      id: sessionId,
      display: cached.summary
        ?? cached.firstUserMessage?.slice(0, 100)
        ?? "Untitled",
      timestamp: Date.parse(cached.startUpdated ?? cached.startTime),
      project: projectPath,
      projectName: getProjectName(projectPath),
      messageCount: cached.messageCount,
      model: cached.model,
      provider: "gemini",
    });
  }

  return sessions.sort((a, b) => b.timestamp - a.timestamp);
}
```

### 4.5 getConversation() — 消息映射表

**UUID**：Gemini 消息自带 `m.id`（UUID），直接用作 `ConversationMessage.uuid`。

解析完整 JSON，遍历 `messages` 数组：

| Gemini 原始 | 转换为 |
|-------------|--------|
| `type: "user"` | `ConversationMessage { type: "user" }` |
| `type: "gemini"` | `ConversationMessage { type: "assistant" }` |
| `type: "info"` | **跳过**（如 "Request cancelled."） |

#### User 消息

```typescript
// content: [{text: "..."}, {text: "..."}] — 多个 text 块
const textContent = m.content.map(c => c.text).join("\n");
→ { type: "user", uuid: m.id, timestamp: m.timestamp, message: { role: "user", content: textContent } }
```

#### Gemini（助手）消息

```typescript
const blocks: ContentBlock[] = [];

// 1. 前置 thinking blocks
if (m.thoughts?.length) {
  for (const thought of m.thoughts) {
    blocks.push({
      type: "thinking",
      thinking: `**${thought.subject}**\n${thought.description}`,
    });
  }
}

// 2. 文本内容（注意 content 是字符串不是数组）
if (m.content) {
  blocks.push({ type: "text", text: m.content });
}

// 3. 工具调用（toolCalls 内嵌在同一消息中）
if (m.toolCalls?.length) {
  for (const tc of m.toolCalls) {
    blocks.push({
      type: "tool_use",
      id: tc.id,
      name: tc.name ?? tc.displayName,
      input: tc.args,
    });
    if (tc.result !== undefined) {
      blocks.push({
        type: "tool_result",
        tool_use_id: tc.id,
        content: typeof tc.result === "string" ? tc.result : JSON.stringify(tc.result),
      });
    }
  }
}

// 4. usage（Gemini 有逐条 token 数据）
const usage = m.tokens ? {
  input_tokens: m.tokens.input ?? 0,
  output_tokens: m.tokens.output ?? 0,
  cache_read_input_tokens: m.tokens.cached ?? 0,
} : undefined;

→ {
  type: "assistant",
  uuid: m.id,
  timestamp: m.timestamp,
  message: {
    role: "assistant",
    content: blocks.length === 1 && blocks[0].type === "text"
      ? blocks[0].text   // 纯文本用字符串
      : blocks,          // 有 thinking/tool 用数组
    model: m.model,
    usage,
  },
}
```

### 4.6 getConversationStream()

Gemini 是完整 JSON（非 JSONL），不能用 byte-offset。

**`fromOffset` 语义改为消息索引**：
- 解析完整 JSON
- 返回索引 >= fromOffset 的消息（经过 convertMessages 转换）
- `nextOffset` = 转换后的消息总数

```typescript
async getConversationStream(sessionId: string, fromOffset: number): Promise<StreamResult> {
  const filePath = this.fileIndex.get(sessionId);
  if (!filePath) return { messages: [], nextOffset: 0 };

  const data = JSON.parse(await readFile(filePath, "utf-8"));
  const allMessages = this.convertMessages(data.messages);
  const newMessages = allMessages.slice(fromOffset);

  return {
    messages: newMessages,
    nextOffset: allMessages.length,
  };
}
```

### 4.7 getSessionMeta()

```typescript
async getSessionMeta(sessionId: string): Promise<SessionMeta> {
  const filePath = this.fileIndex.get(sessionId);
  if (!filePath) return { usage: zeroUsage(), subagents: [] };

  const data = JSON.parse(await readFile(filePath, "utf-8"));
  const usage: SessionTokenUsage = {
    input_tokens: 0,
    output_tokens: 0,
    cache_write_5m_tokens: 0,
    cache_write_1h_tokens: 0,
    cache_read_tokens: 0,
  };

  for (const m of data.messages) {
    if (m.type === "gemini" && m.tokens) {
      usage.input_tokens += m.tokens.input ?? 0;
      usage.output_tokens += m.tokens.output ?? 0;
      usage.cache_read_tokens += m.tokens.cached ?? 0;
    }
  }

  return { usage, subagents: [] };
}
```

### 4.8 resolveSessionId()

```typescript
resolveSessionId(filePath: string): string | null {
  if (filePath.endsWith("projects.json")) return null; // 项目映射变更，非 session 更新
  return this.reverseFileIndex.get(filePath) ?? null;
}
```

### 4.9 addToFileIndex() — 保持 reverseFileIndex 同步

```typescript
addToFileIndex(sessionId: string, filePath: string): void {
  this.fileIndex.set(sessionId, filePath);
  this.reverseFileIndex.set(filePath, sessionId);
}
```

与 Codex adapter 相同。init() 时初始填充，watcher 新增文件时由 server.ts 回调追加。

### 4.10 Watch 配置

```typescript
getWatchPaths() {
  return {
    paths: [
      join(this.geminiDir, "projects.json"),
      join(this.geminiDir, "tmp"),
    ],
    depth: 3, // tmp/<slug>/chats/session-*.json = 3 层
  };
}
```

---

## 5. `api/providers.ts`（新建）

```typescript
import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { ProviderAdapter, ProviderName } from "./provider-types";
import type { Session, ConversationMessage, StreamResult, SessionMeta, SearchResult } from "./storage";
import * as storage from "./storage";
import { CodexAdapter } from "./codex-adapter";
import { GeminiAdapter } from "./gemini-adapter";

class ProviderManager {
  private adapters: ProviderAdapter[] = [];
  private initialized = false;

  async init(claudeDir?: string): Promise<void> {
    this.adapters = [];

    // 1. Claude adapter（始终注册）
    this.adapters.push(createClaudeAdapter(claudeDir));

    // 2. Codex adapter（检测 ~/.codex/ 是否存在）
    const codexDir = join(homedir(), ".codex");
    if (existsSync(join(codexDir, "sessions"))) {
      this.adapters.push(new CodexAdapter(codexDir));
    }

    // 3. Gemini adapter（检测 ~/.gemini/ 是否存在）
    const geminiDir = join(homedir(), ".gemini");
    if (existsSync(join(geminiDir, "tmp"))) {
      this.adapters.push(new GeminiAdapter(geminiDir));
    }

    // 4. 并行初始化所有 adapter
    await Promise.all(this.adapters.map(a => a.init()));
    this.initialized = true;
  }

  async getSessions(provider?: ProviderName): Promise<Session[]> {
    const targets = provider
      ? this.adapters.filter(a => a.name === provider)
      : this.adapters;
    const results = await Promise.all(targets.map(a => a.getSessions()));
    return results.flat().sort((a, b) => b.timestamp - a.timestamp);
  }

  async getProjects(provider?: ProviderName): Promise<string[]> {
    const targets = provider
      ? this.adapters.filter(a => a.name === provider)
      : this.adapters;
    const results = await Promise.all(targets.map(a => a.getProjects()));
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
      : { usage: { input_tokens: 0, output_tokens: 0, cache_write_5m_tokens: 0, cache_write_1h_tokens: 0, cache_read_tokens: 0 }, subagents: [] };
  }

  async searchConversations(query: string, provider?: ProviderName): Promise<SearchResult[]> {
    const targets = provider
      ? this.adapters.filter(a => a.name === provider)
      : this.adapters;
    const results = await Promise.all(targets.map(a => a.searchConversations(query)));
    return results.flat().sort((a, b) => b.timestamp - a.timestamp);
  }

  getProviderForSession(sessionId: string): ProviderName | undefined {
    return this.findAdapter(sessionId)?.name;
  }

  private findAdapter(sessionId: string): ProviderAdapter | undefined {
    return this.adapters.find(a => a.ownsSession(sessionId));
  }

  getAvailableProviders(): ProviderName[] {
    return this.adapters.map(a => a.name);
  }

  getAdapters(): ProviderAdapter[] {
    return this.adapters;
  }

  /**
   * 处理文件变更事件。由 watcher 回调调用。
   * 返回 { isHistoryChange, sessionId? } 供 server.ts 分发 SSE 事件。
   */
  handleFileChange(filePath: string): { isHistoryChange: boolean; sessionId?: string; adapter?: ProviderAdapter } {
    for (const adapter of this.adapters) {
      const sessionId = adapter.resolveSessionId(filePath);
      if (sessionId !== null) {
        // 这是一个 session 文件变更
        adapter.addToFileIndex(sessionId, filePath);
        adapter.invalidateSessionMeta(sessionId);
        return { isHistoryChange: false, sessionId, adapter };
      }
    }

    // 检查是否是索引文件变更（触发列表刷新）
    for (const adapter of this.adapters) {
      const { paths } = adapter.getWatchPaths();
      for (const watchedPath of paths) {
        if (filePath === watchedPath || filePath.startsWith(watchedPath)) {
          // 可能是索引文件变更
          if (adapter.resolveSessionId(filePath) === null) {
            adapter.invalidateHistoryCache();
            return { isHistoryChange: true, adapter };
          }
        }
      }
    }

    return { isHistoryChange: false };
  }
}

export const providerManager = new ProviderManager();
```

### Claude Adapter（薄包装）

```typescript
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
      if (filePath.endsWith("history.jsonl")) return null; // 索引文件
      if (filePath.endsWith(".jsonl")) {
        return basename(filePath, ".jsonl"); // 文件名即 sessionId
      }
      return null;
    },
  };
}
```

---

## 6. `api/watcher.ts`（修改）

### 变更 1：新增 `addWatchTarget()`

```typescript
const extraWatchers: FSWatcher[] = [];

export function addWatchTarget(
  paths: string[],
  depth: number,
  onChangeCallback: (filePath: string) => void
): void {
  const usePolling = process.env.CLAUDE_RUN_USE_POLLING === "1";

  const w = watch(paths, {
    persistent: true,
    ignoreInitial: true,
    usePolling,
    ...(usePolling && { interval: 100 }),
    depth,
  });

  const debouncedCallback = (path: string) => {
    const existing = debounceTimers.get(path);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      debounceTimers.delete(path);
      onChangeCallback(path);
    }, debounceMs);
    debounceTimers.set(path, timer);
  };

  w.on("change", debouncedCallback);
  w.on("add", debouncedCallback);
  w.on("error", (error) => console.error("Watcher error:", error));

  extraWatchers.push(w);
}
```

### 变更 2：`stopWatcher()` 关闭所有 watcher

```diff
 export function stopWatcher(): void {
   if (watcher) {
     watcher.close();
     watcher = null;
   }
+  for (const w of extraWatchers) {
+    w.close();
+  }
+  extraWatchers.length = 0;

   for (const timer of debounceTimers.values()) {
     clearTimeout(timer);
   }
   debounceTimers.clear();
 }
```

不修改现有 `emitChange()`。新 Provider 的文件变更通过 `addWatchTarget` 的回调独立处理。

---

## 7. `api/server.ts`（修改）

### 初始化顺序

**关键约束**：watcher 注册依赖 adapter 的 fileIndex（用于 reverseFileIndex 反查），adapter 的 init 才会填充 fileIndex。所以 watcher 必须在所有 adapter init 完成之后注册。

**方案**：把 `initStorage()`、`initWatcher()`、`startWatcher()`、`onHistoryChange()`、`onSessionChange()`、`addWatchTarget()` 全部移到 `start()` 内部，在 `providerManager.init()` 完成之后执行。`createServer()` 主体内不再有任何初始化和 watcher 代码。

**执行时序**（全部在 `start()` 内，严格顺序）：
```
start()
  ├─ await providerManager.init(claudeDir)
  │    ├─ claudeAdapter.init()            → storage.initStorage() + storage.loadStorage() + 建 fileIndex
  │    ├─ codexAdapter.init()             → 扫描 sessions/，建 fileIndex + reverseFileIndex
  │    └─ geminiAdapter.init()            → 扫描 tmp/*/chats/，建 fileIndex + reverseFileIndex
  │
  ├─ initWatcher(storage.getClaudeDir())  → 设置 Claude watcher 的 claudeDir
  ├─ startWatcher()                       → 启动 Claude 的 chokidar 实例
  ├─ onHistoryChange(...)                 → 注册 Claude history 变更监听
  ├─ onSessionChange(...)                 → 注册 Claude session 变更监听
  │
  ├─ for each non-Claude adapter:
  │    └─ addWatchTarget(paths, depth, callback)
  │         callback 内部：
  │           resolveSessionId(filePath) → 用已建好的 reverseFileIndex 反查
  │           → sessionId? → emitSessionChange()  → SSE session 更新
  │           → null?      → emitHistoryChange()  → SSE 列表刷新
  │
  └─ serve({ fetch: app.fetch, port })    → 启动 HTTP
```

```typescript
export function createServer(options: ServerOptions) {
  const { port, claudeDir, dev = false, open: shouldOpen = true } = options;

  // 不在这里调用 initStorage 和 initWatcher
  // 全部移到 start() 中

  const app = new Hono();

  // ... 路由定义（app.get/post/delete）全部使用 providerManager ...

  return {
    app,
    port,
    start: async () => {
      // ==========================================
      // 1. 初始化所有 Provider（包括 Claude 的 storage）
      // ==========================================
      await providerManager.init(claudeDir);

      // ==========================================
      // 2. 设置 Claude watcher（现有逻辑）
      // ==========================================
      const claudeAdapter = providerManager.getAdapters().find(a => a.name === "claude")!;
      const claudeWatchPaths = claudeAdapter.getWatchPaths();
      initWatcher(storage.getClaudeDir()); // 设置 claudeDir
      startWatcher();                       // 启动 Claude 的 chokidar 实例

      onHistoryChange(() => {
        claudeAdapter.invalidateHistoryCache();
      });

      onSessionChange((sessionId: string, filePath: string) => {
        claudeAdapter.addToFileIndex(sessionId, filePath);
        claudeAdapter.invalidateSessionMeta(sessionId);
      });

      // ==========================================
      // 3. 设置非 Claude Provider 的 watcher
      // ==========================================
      for (const adapter of providerManager.getAdapters()) {
        if (adapter.name === "claude") continue;

        const { paths, depth } = adapter.getWatchPaths();
        addWatchTarget(paths, depth, (filePath) => {
          const sessionId = adapter.resolveSessionId(filePath);

          if (sessionId) {
            // Session 文件变更 → 更新索引 + 触发 SSE session 更新
            adapter.addToFileIndex(sessionId, filePath);
            adapter.invalidateSessionMeta(sessionId);
            // 触发现有 sessionChangeListeners
            for (const callback of sessionChangeListeners) {
              callback(sessionId, filePath);
            }
          } else {
            // 索引文件变更 → 刷新列表
            adapter.invalidateHistoryCache();
            // 触发现有 historyChangeListeners
            for (const callback of historyChangeListeners) {
              callback();
            }
          }
        });
      }

      // ==========================================
      // 4. 启动 HTTP 服务
      // ==========================================
      const openUrl = `http://localhost:${dev ? 12000 : port}/`;
      console.log(`\n  claude-run is running at ${openUrl}\n`);
      if (!dev && shouldOpen) {
        open(openUrl).catch(console.error);
      }
      httpServer = serve({ fetch: app.fetch, port });
      return httpServer;
    },
    stop: () => {
      stopWatcher();
      if (httpServer) httpServer.close();
    },
  };
}
```

**注意**：需要从 `watcher.ts` 额外导出 `historyChangeListeners` 和 `sessionChangeListeners`，或者提供 `emitHistoryChange()` / `emitSessionChange(sessionId, filePath)` 辅助函数。

```typescript
// watcher.ts 新增导出
export function emitHistoryChange(): void {
  for (const callback of historyChangeListeners) {
    callback();
  }
}

export function emitSessionChange(sessionId: string, filePath: string): void {
  for (const callback of sessionChangeListeners) {
    callback(sessionId, filePath);
  }
}
```

这样 server.ts 中非 Claude watcher 的回调可以简化为：

```typescript
addWatchTarget(paths, depth, (filePath) => {
  const sessionId = adapter.resolveSessionId(filePath);
  if (sessionId) {
    adapter.addToFileIndex(sessionId, filePath);
    adapter.invalidateSessionMeta(sessionId);
    emitSessionChange(sessionId, filePath);  // 触发 SSE
  } else {
    adapter.invalidateHistoryCache();
    emitHistoryChange();  // 触发 SSE 列表刷新
  }
});
```

### 各 API 端点修改

#### `GET /api/sessions`
```diff
-  const sessions = await getSessions();
+  const provider = c.req.query("provider") as ProviderName | undefined;
+  const sessions = await providerManager.getSessions(provider);
```

#### `GET /api/sessions/stream`
```diff
+  const provider = c.req.query("provider") as ProviderName | undefined;
   // handleHistoryChange 中和初始发送时：
-  const sessions = await getSessions();
+  const sessions = await providerManager.getSessions(provider);
```

#### `DELETE /api/sessions/:id`
```diff
+  const sessionProvider = providerManager.getProviderForSession(sessionId);
+  if (sessionProvider && sessionProvider !== "claude") {
+    return c.json({ error: "Delete not supported for this provider" }, 400);
+  }
```

#### `POST /api/sessions/:id/rename`
```diff
+  const sessionProvider = providerManager.getProviderForSession(sessionId);
+  if (sessionProvider && sessionProvider !== "claude") {
+    return c.json({ error: "Rename not supported for this provider" }, 400);
+  }
```

#### `GET /api/conversation/:id`
```diff
-  const messages = await getConversation(sessionId);
+  const messages = await providerManager.getConversation(sessionId);
```

#### `GET /api/conversation/:id/meta`
```diff
-  const meta = await getSessionMeta(sessionId);
+  const meta = await providerManager.getSessionMeta(sessionId);
```

#### `GET /api/conversation/:id/stream`
```diff
-  await getConversationStream(sessionId, offset);
+  await providerManager.getConversationStream(sessionId, offset);
```

#### `GET /api/conversation/:id/subagents` 和 `/subagent/:agentId`
```typescript
// 加 provider 守卫
const provider = providerManager.getProviderForSession(sessionId);
if (provider && provider !== "claude") return c.json([]);
```

#### `POST /api/search`
```diff
-  const body = await c.req.json<{ query: string }>();
+  const body = await c.req.json<{ query: string; provider?: ProviderName }>();
-  const results = await searchConversations(query);
+  const results = await providerManager.searchConversations(query, body?.provider);
```

#### `GET /api/projects`
```diff
-  const projects = await getProjects();
+  const projects = await providerManager.getProjects();
```

### 新增端点

```typescript
app.get("/api/providers", async (c) => {
  const providers = providerManager.getAvailableProviders();
  const sessions = await providerManager.getSessions();

  const result = providers.map((name) => ({
    name,
    sessionCount: sessions.filter((s) => s.provider === name).length,
  }));

  return c.json(result);
});
```

---

## 8. `web/utils.ts`（修改）

### 变更 1：扩展 PROVIDER_RULES

```diff
 const PROVIDER_RULES = [
   { test: (m) => m.startsWith("kimi"), info: { label: "Kimi", color: "text-purple-400 bg-purple-500/15 border-purple-500/25" } },
   { test: (m) => m.startsWith("glm"), info: { label: "GLM", color: "text-green-400 bg-green-500/15 border-green-500/25" } },
   { test: (m) => m.startsWith("claude"), info: { label: "Claude", color: "text-orange-400 bg-orange-500/15 border-orange-500/25" } },
+  { test: (m) => /^(gpt|o[1-9]|codex)/.test(m), info: { label: "OpenAI", color: "text-emerald-400 bg-emerald-500/15 border-emerald-500/25" } },
+  { test: (m) => m.startsWith("gemini"), info: { label: "Gemini", color: "text-blue-400 bg-blue-500/15 border-blue-500/25" } },
 ];
```

### 变更 2：新增 `getCliProviderInfo()`

区分"模型提供商"（model provider，如 Claude / OpenAI / Gemini）和"CLI 工具"（如 Claude Code / Codex CLI / Gemini CLI）。

```typescript
export function getCliProviderInfo(
  provider?: string
): { label: string; color: string } | null {
  switch (provider) {
    case "claude":
      return { label: "Claude Code", color: "text-orange-400 bg-orange-500/15 border-orange-500/25" };
    case "codex":
      return { label: "Codex", color: "text-emerald-400 bg-emerald-500/15 border-emerald-500/25" };
    case "gemini":
      return { label: "Gemini CLI", color: "text-blue-400 bg-blue-500/15 border-blue-500/25" };
    default:
      return null;
  }
}
```

---

## 9. `web/app.tsx`（修改）

### 变更 1：新增 `selectedProvider` state + 动态获取 providers

```typescript
const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
const [providers, setProviders] = useState<{ name: string; sessionCount: number }[]>([]);

useEffect(() => {
  fetch("/api/providers")
    .then(res => res.json())
    .then(setProviders)
    .catch(console.error);
}, []);
```

### 变更 2：Provider 筛选下拉框

```tsx
<div className="border-b border-zinc-800/60">
  <label htmlFor="select-project" className="block w-full px-1">
    <select /* existing project select */ />
  </label>
  {providers.length > 1 && (
    <label htmlFor="select-provider" className="block w-full px-1">
      <select
        id="select-provider"
        value={selectedProvider || ""}
        onChange={(e) => setSelectedProvider(e.target.value || null)}
        className="w-full h-[36px] bg-transparent text-zinc-300 text-sm focus:outline-none cursor-pointer px-5 py-2"
      >
        <option value="">All Providers</option>
        {providers.map(p => (
          <option key={p.name} value={p.name}>
            {getCliProviderInfo(p.name)?.label ?? p.name} ({p.sessionCount})
          </option>
        ))}
      </select>
    </label>
  )}
</div>
```

只有检测到 > 1 个 provider 时才显示筛选下拉。

### 变更 3：`filteredSessions` 同时按 project 和 provider 筛选

```diff
 const filteredSessions = useMemo(() => {
-  if (!selectedProject) return sessions;
-  return sessions.filter((s) => s.project === selectedProject);
-}, [sessions, selectedProject]);
+  let result = sessions;
+  if (selectedProject) {
+    result = result.filter((s) => s.project === selectedProject);
+  }
+  if (selectedProvider) {
+    result = result.filter((s) => s.provider === selectedProvider);
+  }
+  return result;
+}, [sessions, selectedProject, selectedProvider]);
```

### 变更 4：`selectedProvider` 传递给 SessionList

```diff
 <SessionList
   sessions={filteredSessions}
   selectedSession={selectedSession}
   onSelectSession={handleSelectSession}
   onDeleteSession={handleDeleteSession}
   loading={loading}
+  selectedProvider={selectedProvider}
 />
```

### 变更 5：`handleCopyResumeCommand` 按 provider 生成不同命令

```typescript
const handleCopyResumeCommand = useCallback(
  (sessionId: string, projectPath: string, provider?: string) => {
    let command: string;
    switch (provider) {
      case "codex":
        command = `cd ${projectPath} && codex resume ${sessionId}`;
        break;
      case "gemini":
        return; // Gemini CLI 不支持 resume
      default:
        command = `cd ${projectPath} && claude --resume ${sessionId}`;
    }
    navigator.clipboard.writeText(command).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  },
  [],
);
```

### 变更 6：SessionHeader 按 provider 控制 Rename 和 Resume

```tsx
// Rename：仅 Claude 支持
{session.provider === "claude" ? (
  <button onClick={handleStartEdit} className="group flex items-center gap-2 min-w-0">
    <span className="...">{session.display}</span>
    <Pencil className="..." />
  </button>
) : (
  <span className="text-sm text-zinc-300 truncate max-w-xs">{session.display}</span>
)}

// Resume：Gemini 不支持，隐藏按钮
{session.provider !== "gemini" && (
  <button onClick={() => onCopyResumeCommand(session.id, session.project, session.provider)}>
    {/* ... */}
  </button>
)}
```

---

## 10. `web/components/session-list.tsx`（修改）

### 变更 1：接收 `selectedProvider` prop

```diff
 interface SessionListProps {
   sessions: Session[];
   selectedSession: string | null;
   onSelectSession: (sessionId: string) => void;
   onDeleteSession?: (sessionId: string) => void;
   loading?: boolean;
+  selectedProvider?: string | null;
 }
```

### 变更 2：全文搜索传递 provider 参数（修复 Finding #4）

```diff
 const performContentSearch = useCallback(async (query: string) => {
   // ...
   const response = await fetch("/api/search", {
     method: "POST",
     headers: { "Content-Type": "application/json" },
-    body: JSON.stringify({ query }),
+    body: JSON.stringify({ query, provider: selectedProvider ?? undefined }),
     signal: abortController.signal,
   });
   // ...
-}, []);
+}, [selectedProvider]);
```

### 变更 3：显示 CLI Provider 徽章

```tsx
<span className="text-[10px] text-zinc-500 font-medium flex items-center gap-1.5">
  {session.projectName}
  {/* CLI Provider 徽章（仅非 Claude 时显示，避免 Claude 场景多一个冗余标签） */}
  {session.provider !== "claude" && (() => {
    const cli = getCliProviderInfo(session.provider);
    return cli ? (
      <span className={`px-1 py-px rounded text-[9px] font-medium border ${cli.color}`}>
        {cli.label}
      </span>
    ) : null;
  })()}
  {/* Model Provider 徽章（如果有 model 信息） */}
  {provider && (
    <span className={`px-1 py-px rounded text-[9px] font-medium border ${provider.color}`}>
      {provider.label}
    </span>
  )}
</span>
```

### 变更 4：Delete 按钮仅对 Claude session 显示

```diff
-  {onDeleteSession ? (
+  {onDeleteSession && session.provider === "claude" ? (
```

---

## 11. `web/components/session-view.tsx`（修改）— 修复 Finding #5

### 问题

当前 `TokenUsageBar` 硬编码了 Claude 的价格（$5/MTok input, $25/MTok output 等）。Gemini 显示这些价格会误导用户，Codex 显示 $0.0000 虽然"正确"但毫无意义。

### 方案

根据 session.provider 决定是否显示 TokenUsageBar 和如何显示：

```typescript
// session-view.tsx 变更

// 1. 从 session prop 获取 provider
const { sessionId, session } = props;

// 2. Token 使用条件渲染
{tokenUsage && session.provider === "claude" && (
  <div className="mb-6">
    <TokenUsageBar usage={tokenUsage} />
  </div>
)}

{tokenUsage && session.provider === "gemini" && hasNonZeroUsage(tokenUsage) && (
  <div className="mb-6">
    <GeminiTokenUsageBar usage={tokenUsage} />
  </div>
)}

// Codex：不显示 token（无数据）
```

#### GeminiTokenUsageBar 组件

Gemini 的定价与 Claude 不同，而且可能没有公开的 API 定价。只显示 token 计数，不显示成本：

```typescript
function GeminiTokenUsageBar({ usage }: { usage: SessionTokenUsage }) {
  const items = [
    { label: "Input", count: usage.input_tokens },
    { label: "Output", count: usage.output_tokens },
    { label: "Cache Read", count: usage.cache_read_tokens },
  ].filter(item => item.count > 0);

  if (items.length === 0) return null;

  const total = items.reduce((sum, i) => sum + i.count, 0);

  return (
    <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Token Usage</h3>
        <span className="text-sm font-medium text-zinc-300">{formatTokenCount(total)} total</span>
      </div>
      <div className={`grid grid-cols-${items.length} gap-3`}>
        {items.map(({ label, count }) => (
          <div key={label} className="text-center">
            <div className="text-[11px] text-zinc-500 mb-1">{label}</div>
            <div className="text-sm text-zinc-200 font-mono">{formatTokenCount(count)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function hasNonZeroUsage(usage: SessionTokenUsage): boolean {
  return usage.input_tokens > 0 || usage.output_tokens > 0 || usage.cache_read_tokens > 0;
}
```

---

## 12. `web/components/markdown-export.tsx`（修改）

### 问题

当前硬编码了 `"🤖 Claude"` 作为助手角色名，`"*Exported from Claude Run*"` 作为尾注。接入 Codex/Gemini 后语义不正确。

### 变更

```diff
 // MarkdownExportProps 新增 session，已有
 // 根据 session.provider 选择角色名
-const role = isUser ? "👤 User" : "🤖 Claude";
+const role = isUser ? "👤 User" : getAssistantLabel(session.provider);

 // 尾注
-markdown += `*Exported from Claude Run • ${new Date().toLocaleString()}*`;
+markdown += `*Exported from Claude Run • ${new Date().toLocaleString()}*`;
 // 尾注不改（Claude Run 是产品名，不是 provider 名）
```

新增辅助函数：
```typescript
function getAssistantLabel(provider?: string): string {
  switch (provider) {
    case "codex": return "🤖 Codex";
    case "gemini": return "🤖 Gemini";
    default: return "🤖 Claude";
  }
}
```

---

## 13. `web/components/message-block.tsx`（修改）

### 问题

Codex 的工具名是 `exec_command`，而非 Claude 的 `bash`。现有 `TOOL_ICONS` 和 `TOOL_PREVIEW_HANDLERS` 不会匹配。Gemini 的工具名是 `replace`、`read_file` 等，也需要映射。

### 变更

```diff
 const TOOL_ICONS: Record<string, typeof Wrench> = {
   todowrite: ListTodo,
   read: FileCode,
   bash: Terminal,
   grep: Search,
   edit: Pencil,
   write: FilePlus2,
   glob: FolderOpen,
   task: Bot,
+  exec_command: Terminal,    // Codex
+  read_file: FileCode,       // Gemini
+  replace: Pencil,           // Gemini (file edit)
+  write_file: FilePlus2,     // Gemini
 };
```

```diff
 const TOOL_PREVIEW_HANDLERS: Record<string, PreviewHandler> = {
   // ... existing handlers ...
+  exec_command: (input) => {
+    if (!input.cmd) return null;
+    const cmd = String(input.cmd);
+    return cmd.length > 50 ? cmd.slice(0, 50) + "..." : cmd;
+  },
+  read_file: (input) => input.file_path ? getFilePathPreview(String(input.file_path)) : null,
+  replace: (input) => input.file_path ? getFilePathPreview(String(input.file_path)) : null,
+  write_file: (input) => input.file_path ? getFilePathPreview(String(input.file_path)) : null,
 };
```

不需要新增 special renderer — Codex/Gemini 的工具输入用通用 JSON 渲染即可，已有的 `ToolInputRenderer` fallback 会处理。

---

## 边界情况处理

### 1. Codex session_index 只有 19 条，但有 282 个 session 文件

大部分 session 没有 `thread_name`。这些 session 的 display 从首条 `role: "user"` 消息提取（截取前 100 字符）。

**性能**：init 时并行读 282 个文件（限制并发 50），每个文件扫描前 ~20 行找 user 消息。预估 < 2 秒。

### 2. developer 角色消息是系统指令

实际数据验证：`payload.role: "developer"` 包含 `<permissions instructions>`、`<collaboration_mode>` 等系统配置，不是用户输入。**跳过不显示**。

首条 user 消息查找也只找 `role: "user"`，不找 `role: "developer"`。

### 3. Codex CLI 与 Desktop 共用数据目录

4 种 originator 共用 `~/.codex/`。合并为一个 `codex` provider。可在 session 列表中通过 originator 显示子标签（如 `[Desktop]`），但这是 UI 优化，不影响核心功能。

### 4. Gemini toolCalls 内嵌在消息中

Gemini 的 `toolCalls` 包含 `{id, name, args, result, status}` —— tool_use 和 tool_result 都在同一条 gemini 消息中。转换时在一个 `ConversationMessage` 的 `content[]` 中依次放入 tool_use 和 tool_result blocks。

### 5. Gemini stream offset 语义不同

Gemini 用消息索引而非字节偏移。watcher 触发后重新解析整个 JSON 文件，对比索引差异。65MB 数据的 JSON.parse 约需 50-100ms，可接受。

### 6. Codex reasoning 内容加密

`summary=[]`, `content=null`, `encrypted_content=加密字符串`。只能显示 `"[Reasoning]"` 占位符。

### 7. Session ID 冲突

三个 Provider 的 session ID 均为 UUID，冲突概率为零。`findAdapter()` 遍历所有 adapter 的 `ownsSession()` 方法，第一个匹配即返回。

### 8. 启动性能

282 (Codex) + 51 (Gemini) = 333 文件。Codex 读首行 + 扫描前 20 行，Gemini 解析完整 JSON 但只缓存元数据。总耗时预估 < 3 秒。

### 9. 全文搜索覆盖 provider 筛选

`/api/search` 接受可选 `provider` 字段。前端 SessionList 的 `performContentSearch` 发送请求时携带 `selectedProvider`。确保切到 Content 搜索模式时结果按 provider 过滤。

---

## 文件变更清单

| 文件 | 操作 | 行数估计 |
|------|------|----------|
| `api/provider-types.ts` | 新建 | ~50 行 |
| `api/codex-adapter.ts` | 新建 | ~400 行 |
| `api/gemini-adapter.ts` | 新建 | ~320 行 |
| `api/providers.ts` | 新建 | ~200 行 |
| `api/storage.ts` | 修改 | +8 行 |
| `api/server.ts` | 修改 | ~60 行变更 |
| `api/watcher.ts` | 修改 | +40 行 |
| `web/utils.ts` | 修改 | +25 行 |
| `web/app.tsx` | 修改 | ~40 行变更 |
| `web/components/session-list.tsx` | 修改 | ~20 行变更 |
| `web/components/session-view.tsx` | 修改 | ~50 行变更 |
| `web/components/markdown-export.tsx` | 修改 | ~10 行变更 |
| `web/components/message-block.tsx` | 修改 | ~15 行变更 |

---

## 验证检查表

- [ ] `pnpm build` 编译通过
- [ ] 现有 Claude 功能完全不受影响（回归测试）
- [ ] 会话列表同时展示 Claude、Codex、Gemini 的会话
- [ ] 非 Claude session 显示 CLI Provider 徽章（Codex / Gemini CLI）
- [ ] Provider 筛选下拉正常工作，仅 > 1 个 provider 时显示
- [ ] Codex 会话正确显示：`role: "user"` → user，`role: "developer"` → 跳过，`role: "assistant"` → assistant
- [ ] Codex function_call 正确显示为 tool_use
- [ ] Codex reasoning 显示 `[Reasoning]` 占位符
- [ ] Codex Desktop / CLI / TUI / Exec 的会话均正常显示
- [ ] Gemini 会话正确显示：user → user, gemini → assistant, thoughts → thinking
- [ ] Gemini toolCalls 正确显示（tool_use + tool_result 内嵌）
- [ ] Token 统计：Claude 显示成本，Gemini 显示计数（无成本），Codex 不显示
- [ ] 全文搜索：Content 模式下按 provider 筛选结果正确
- [ ] SSE 实时推送对所有 Provider 生效（非 Claude 文件变更能触发 session/history 更新）
- [ ] Claude 删除/重命名正常
- [ ] Codex/Gemini 删除返回 400，重命名返回 400
- [ ] Resume 命令：Claude 用 `claude --resume`，Codex 用 `codex resume`，Gemini 隐藏按钮
- [ ] 删除按钮仅对 Claude session 显示
- [ ] Codex `exec_command` 工具显示 Terminal 图标和命令预览
- [ ] Markdown 导出：Codex 会话角色名为 "Codex"，Gemini 为 "Gemini"
- [ ] Codex 消息流式追加无重复渲染（uuid 去重正常）
- [ ] Session.surface 字段正确反映 originator（Codex Desktop → "app" 等）
