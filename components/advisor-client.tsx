"use client";

// AI Portfolio Advisor — conversational chat with full portfolio context.
// Sessions persisted to DB. Sidebar lists past sessions.
// [[TICKER]] markers rendered as Deep Value launch chips.
import { useState, useEffect, useRef, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useLanguage } from "@/context/language-context";
import { APP_TO_AI_LANGUAGE } from "@/lib/i18n/translations";

type ChatMessage = { id: string; role: "user" | "assistant"; content: string };
type AdvisorSession = { id: string; title: string; createdAt: string; updatedAt: string };

// ─── Markdown / ticker helpers ────────────────────────────────────────────────

// Convert [[TICKER]] to relative /?ticker= URLs — ReactMarkdown filters non-http protocols.
function preprocessMarkdown(content: string): string {
  return content.replace(/\[\[([A-Z0-9.]+)\]\]/g, "[$1](/?ticker=$1)");
}

function MessageContent({ content, onAddToCompare }: { content: string; onAddToCompare?: (ticker: string) => void }) {
  const { t } = useLanguage();
  return (
    <div className="prose prose-invert prose-sm max-w-none prose-headings:text-slate-100 prose-headings:mt-4 prose-headings:mb-1.5 prose-p:text-slate-300 prose-p:leading-relaxed prose-p:my-1.5 prose-strong:text-slate-100 prose-li:text-slate-300 prose-li:my-0.5 prose-a:text-sky-400 prose-table:w-full prose-th:text-slate-200 prose-td:text-slate-300 prose-hr:border-slate-700/50 prose-code:text-sky-300 prose-code:bg-slate-800 prose-code:px-1 prose-code:py-0.5 prose-code:rounded">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a({ href, children }) {
            const tickerMatch = href?.match(/^\/\?ticker=([A-Z0-9.]+)$/);
            if (tickerMatch) {
              const ticker = tickerMatch[1];
              return (
                <span className="mx-0.5 inline-flex items-stretch rounded-md ring-1 ring-inset ring-sky-500/30">
                  <button
                    // Full navigation to bypass Next.js Router Cache — router.push would
                    // restore the cached dashboard without remounting.
                    onClick={() => { window.location.href = `/?ticker=${encodeURIComponent(ticker)}`; }}
                    className="inline-flex items-center gap-1 bg-sky-500/15 px-2 py-0.5 text-xs font-semibold text-sky-300 transition hover:bg-sky-500/25 hover:text-sky-200 rounded-l-md"
                  >
                    {children}
                    <span className="text-[10px] opacity-60">{t("advisorRunDeepValue")}</span>
                  </button>
                  {onAddToCompare && (
                    <>
                      <span className="w-px bg-sky-500/30" />
                      <button
                        onClick={(e) => { e.stopPropagation(); onAddToCompare(ticker); }}
                        title={t("advisorAddToCompare")}
                        className="inline-flex items-center bg-sky-500/10 px-1.5 text-xs text-sky-400 transition hover:bg-sky-500/25 hover:text-sky-200 rounded-r-md"
                      >
                        +
                      </button>
                    </>
                  )}
                </span>
              );
            }
            return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
          },
        }}
      >
        {preprocessMarkdown(content)}
      </ReactMarkdown>
    </div>
  );
}

// ─── Message bubbles ──────────────────────────────────────────────────────────

function UserBubble({ content }: { content: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[76%] rounded-2xl rounded-tr-sm border border-sky-500/20 bg-[rgba(56,189,248,0.07)] px-4 py-2.5 text-sm text-slate-100">
        <span className="whitespace-pre-wrap break-words">{content}</span>
      </div>
    </div>
  );
}

function AssistantBubble({ content, isStreaming, onAddToCompare }: { content: string; isStreaming?: boolean; onAddToCompare?: (ticker: string) => void }) {
  return (
    <div className="flex justify-start">
      <div className="w-full rounded-2xl rounded-tl-sm border border-slate-700/30 bg-[#0f172a] px-4 py-3 text-sm text-slate-200 shadow-[0_4px_20px_-8px_rgba(56,189,248,0.10)]">
        <MessageContent content={content} onAddToCompare={onAddToCompare} />
        {isStreaming && content && (
          <span className="ml-0.5 inline-block h-3.5 w-0.5 animate-pulse bg-sky-400" />
        )}
      </div>
    </div>
  );
}

function ThinkingBubble({ label }: { label: string }) {
  return (
    <div className="flex justify-start">
      <div className="rounded-2xl rounded-tl-sm border border-slate-700/30 bg-[#0f172a] px-4 py-3 shadow-[0_4px_20px_-8px_rgba(56,189,248,0.10)]">
        <span className="flex items-center gap-2.5 text-xs text-slate-500">
          <span className="flex gap-1">
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-sky-500 [animation-delay:0ms]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-sky-500 [animation-delay:150ms]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-sky-500 [animation-delay:300ms]" />
          </span>
          {label}
        </span>
      </div>
    </div>
  );
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

function PlusIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M1.5 3h9M4.5 3V2a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 .5.5v1m1 0-.5 7a.5.5 0 0 1-.5.5H4a.5.5 0 0 1-.5-.5L3 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SessionSidebar({
  sessions,
  activeId,
  onSelect,
  onNew,
  onDelete,
}: {
  sessions: AdvisorSession[];
  activeId: string | null;
  onSelect: (s: AdvisorSession) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}) {
  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  return (
    <aside className="flex w-52 flex-shrink-0 flex-col border-r border-slate-800 pr-3">
      <p className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
        Conversations
      </p>

      <button
        onClick={onNew}
        className="mb-3 flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-400 transition hover:border-sky-500/40 hover:text-sky-300"
      >
        <PlusIcon />
        New chat
      </button>

      <div className="flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {sessions.length === 0 ? (
          <p className="mt-4 text-center text-xs text-slate-600">No saved conversations</p>
        ) : (
          <ul className="space-y-0.5">
            {sessions.map((s) => (
              <li key={s.id} className="group relative">
                <button
                  onClick={() => onSelect(s)}
                  className={`w-full rounded-lg px-2.5 py-2 pr-7 text-left text-xs transition ${
                    s.id === activeId
                      ? "border border-sky-500/15 bg-sky-500/[0.08] text-slate-100"
                      : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
                  }`}
                >
                  <span className="block truncate font-medium leading-snug">{s.title}</span>
                  <span className="mt-0.5 block text-[10px] text-slate-500">
                    {formatDate(s.updatedAt)}
                  </span>
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(s.id); }}
                  className="absolute right-1.5 top-2.5 hidden rounded p-0.5 text-slate-600 transition hover:text-rose-400 group-hover:block"
                  aria-label="Delete session"
                >
                  <TrashIcon />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function ArrowRight() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" className="flex-shrink-0 opacity-40">
      <path d="M2.5 7h9M8 3.5 11.5 7 8 10.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function EmptyState({
  mode,
  contextCounts,
  examplePrompts,
  onSend,
}: {
  mode: "portfolio" | "discovery";
  contextCounts: { positions: number; analyses: number } | null;
  examplePrompts: string[];
  onSend: (text: string) => void;
}) {
  const { t } = useLanguage();
  const title = mode === "discovery" ? t("advisorDiscoveryEmptyTitle") : t("advisorEmptyTitle");
  const hint = mode === "discovery" ? t("advisorDiscoveryEmptyHint") : t("advisorEmptyHint");
  return (
    <div className="flex h-full flex-col items-center justify-center gap-7 px-4">
      <div className="text-center">
        {/* Context awareness pill — only in portfolio mode */}
        {mode === "portfolio" && contextCounts !== null && (
          <div className="mx-auto mb-3 inline-flex items-center gap-2 rounded-full border border-slate-700/60 bg-slate-800/50 px-3 py-1">
            <span className="h-1.5 w-1.5 rounded-full bg-sky-500" />
            <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
              {contextCounts.positions} position{contextCounts.positions !== 1 ? "s" : ""} · {contextCounts.analyses} anal{contextCounts.analyses !== 1 ? "yses" : "ysis"} loaded
            </span>
          </div>
        )}
        <p className="text-sm font-semibold text-slate-200">{title}</p>
        <p className="mt-1 text-xs text-slate-500">{hint}</p>
      </div>

      <div className="w-full max-w-sm space-y-1.5">
        {examplePrompts.map((prompt) => (
          <button
            key={prompt}
            onClick={() => onSend(prompt)}
            className="group flex w-full items-center justify-between gap-3 rounded-lg border border-slate-700/60 bg-slate-800/30 px-3.5 py-2.5 text-left text-xs text-slate-400 transition hover:border-slate-600 hover:bg-slate-800/60 hover:text-slate-200"
          >
            <span>{prompt}</span>
            <ArrowRight />
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function AdvisorClient() {
  const { t, language } = useLanguage();
  const [sessions, setSessions] = useState<AdvisorSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contextCounts, setContextCounts] = useState<{ positions: number; analyses: number } | null>(null);
  const [mode, setMode] = useState<"portfolio" | "discovery">("portfolio");
  const [compareQueue, setCompareQueue] = useState<string[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Persist mode to localStorage
  useEffect(() => {
    const saved = localStorage.getItem("sfa:advisor-mode");
    if (saved === "portfolio" || saved === "discovery") setMode(saved);
  }, []);

  useEffect(() => {
    localStorage.setItem("sfa:advisor-mode", mode);
  }, [mode]);

  // Persist compare queue to localStorage
  useEffect(() => {
    const saved = localStorage.getItem("sfa:compareQueue");
    if (saved) {
      try { setCompareQueue(JSON.parse(saved)); } catch { /* ignore */ }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("sfa:compareQueue", JSON.stringify(compareQueue));
  }, [compareQueue]);

  function addToCompareQueue(ticker: string) {
    setCompareQueue((prev) => {
      if (prev.includes(ticker) || prev.length >= 5) return prev;
      return [...prev, ticker];
    });
  }

  function launchCompare() {
    if (compareQueue.length === 0) return;
    const tickers = compareQueue.join(",");
    setCompareQueue([]);
    window.location.href = `/compare?tickers=${tickers}`;
  }

  // Load session list + context counts on mount.
  useEffect(() => {
    fetch("/api/advisor/sessions")
      .then((r) => r.json())
      .then((data: AdvisorSession[]) => {
        setSessions(data);
        if (data.length > 0) loadSession(data[0]);
      })
      .catch(() => {});

    Promise.all([
      fetch("/api/positions").then((r) => r.json()),
      fetch("/api/analyses").then((r) => r.json()),
    ])
      .then(([positions, analyses]) => {
        setContextCounts({
          positions: Array.isArray(positions) ? positions.length : 0,
          analyses: Array.isArray(analyses) ? analyses.length : 0,
        });
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isStreaming]);

  async function loadSession(s: AdvisorSession) {
    setActiveSessionId(s.id);
    setMessages([]);
    setError(null);
    try {
      const res = await fetch(`/api/advisor/sessions/${s.id}`);
      const data = await res.json();
      setMessages(
        (data.messages ?? []).map((m: { id: string; role: string; content: string }) => ({
          id: m.id,
          role: m.role as "user" | "assistant",
          content: m.content,
        }))
      );
    } catch { /* silent */ }
  }

  function startNewChat() {
    setActiveSessionId(null);
    setMessages([]);
    setInput("");
    setError(null);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }

  async function deleteSession(id: string) {
    await fetch(`/api/advisor/sessions/${id}`, { method: "DELETE" });
    setSessions((prev) => prev.filter((s) => s.id !== id));
    if (activeSessionId === id) startNewChat();
  }

  async function persistMessages(sessionId: string, msgs: ChatMessage[]) {
    await fetch(`/api/advisor/sessions/${sessionId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: msgs.map((m) => ({ role: m.role, content: m.content })),
      }),
    });
    setSessions((prev) => {
      const hit = prev.find((s) => s.id === sessionId);
      if (!hit) return prev;
      return [{ ...hit, updatedAt: new Date().toISOString() }, ...prev.filter((s) => s.id !== sessionId)];
    });
  }

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isStreaming) return;

      setError(null);
      const userMsg: ChatMessage = { id: crypto.randomUUID(), role: "user", content: trimmed };
      const nextMessages = [...messages, userMsg];
      setMessages(nextMessages);
      setInput("");
      if (textareaRef.current) textareaRef.current.style.height = "auto";
      setIsStreaming(true);

      let sessionId = activeSessionId;
      if (!sessionId) {
        try {
          const res = await fetch("/api/advisor/sessions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: trimmed.slice(0, 80) }),
          });
          const newSession: AdvisorSession = await res.json();
          sessionId = newSession.id;
          setActiveSessionId(newSession.id);
          setSessions((prev) => [newSession, ...prev]);
        } catch {
          setError(t("advisorErrorFailed"));
          setIsStreaming(false);
          return;
        }
      }

      const assistantId = crypto.randomUUID();
      setMessages((prev) => [...prev, { id: assistantId, role: "assistant", content: "" }]);
      abortRef.current = new AbortController();

      try {
        const res = await fetch("/api/ai/advisor", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: nextMessages.map((m) => ({ role: m.role, content: m.content })),
            language: APP_TO_AI_LANGUAGE[language],
            mode,
          }),
          signal: abortRef.current.signal,
        });

        if (!res.ok || !res.body) throw new Error(t("advisorErrorFailed"));

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let assistantContent = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          assistantContent += chunk;
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + chunk } : m))
          );
        }

        await persistMessages(sessionId, [
          ...nextMessages,
          { id: assistantId, role: "assistant" as const, content: assistantContent },
        ]);
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        setError(t("advisorErrorFailed"));
        setMessages((prev) => prev.filter((m) => m.id !== assistantId));
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [messages, isStreaming, language, t, activeSessionId, mode]
  );

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  }

  function handleTextareaInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }

  const examplePrompts =
    mode === "discovery"
      ? [
          t("advisorDiscoveryExample1"),
          t("advisorDiscoveryExample2"),
          t("advisorDiscoveryExample3"),
          t("advisorDiscoveryExample4"),
        ]
      : [
          t("advisorExampleItalian"),
          t("advisorExampleUndervalued"),
          t("advisorExamplePortfolio"),
        ];

  const lastAssistantMsg = isStreaming
    ? [...messages].reverse().find((m) => m.role === "assistant")
    : null;
  const streamingAssistantId = lastAssistantMsg?.id ?? null;
  const showThinking =
    isStreaming &&
    streamingAssistantId != null &&
    messages.find((m) => m.id === streamingAssistantId)?.content === "";

  return (
    <div className="flex flex-1 gap-5 overflow-hidden">
      <SessionSidebar
        sessions={sessions}
        activeId={activeSessionId}
        onSelect={loadSession}
        onNew={startNewChat}
        onDelete={deleteSession}
      />

      {/* Chat area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Mode toggle */}
        <div className="flex items-center justify-between pb-3">
          <div className="inline-flex gap-0.5 rounded-lg border border-slate-800 bg-slate-900/60 p-0.5">
            <button
              onClick={() => setMode("portfolio")}
              className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                mode === "portfolio"
                  ? "bg-slate-700 text-slate-100 shadow-sm"
                  : "text-slate-500 hover:text-slate-300"
              }`}
            >
              {t("advisorModePortfolio")}
            </button>
            <button
              onClick={() => setMode("discovery")}
              className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                mode === "discovery"
                  ? "bg-slate-700 text-slate-100 shadow-sm"
                  : "text-slate-500 hover:text-slate-300"
              }`}
            >
              {t("advisorModeDiscovery")}
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {messages.length === 0 ? (
            <EmptyState
              mode={mode}
              contextCounts={contextCounts}
              examplePrompts={examplePrompts}
              onSend={sendMessage}
            />
          ) : (
            <div className="space-y-3 py-2 pr-0.5">
              {messages.map((m) =>
                m.role === "user" ? (
                  <UserBubble key={m.id} content={m.content} />
                ) : (
                  <AssistantBubble
                    key={m.id}
                    content={m.content}
                    isStreaming={m.id === streamingAssistantId}
                    onAddToCompare={addToCompareQueue}
                  />
                )
              )}
              {showThinking && <ThinkingBubble label={t("advisorThinking")} />}
            </div>
          )}
          {error && <p className="mt-3 text-center text-xs text-rose-400">{error}</p>}
          <div ref={bottomRef} />
        </div>

        {/* Compare queue bar */}
        {compareQueue.length > 0 && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-sky-800/50 bg-sky-950/30 px-3 py-2 mb-2">
            <div className="flex flex-wrap gap-1.5">
              {compareQueue.map((ticker) => (
                <span key={ticker} className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-sky-300">
                  {ticker}
                </span>
              ))}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={() => setCompareQueue([])}
                className="text-xs text-slate-600 transition hover:text-slate-400"
              >
                ✕
              </button>
              <button
                onClick={launchCompare}
                className="rounded-lg border border-sky-700 bg-sky-900/30 px-3 py-1 text-xs font-semibold text-sky-300 transition hover:border-sky-500 hover:bg-sky-900/50"
              >
                {t("advisorCompareQueue").replace("{n}", String(compareQueue.length))}
              </button>
            </div>
          </div>
        )}

        {/* Input bar */}
        <div className="pt-2">
          <div className="flex items-end gap-2 rounded-xl border border-slate-700/60 bg-[rgba(15,23,42,0.85)] px-3 py-2 transition focus-within:border-sky-500/50 focus-within:shadow-[0_0_0_3px_rgba(56,189,248,0.10)]">
            <textarea
              ref={textareaRef}
              rows={1}
              value={input}
              onChange={handleTextareaInput}
              onKeyDown={handleKeyDown}
              disabled={isStreaming}
              placeholder={t("advisorInputPlaceholder")}
              className="flex-1 resize-none bg-transparent text-sm text-slate-100 placeholder-slate-600 focus:outline-none disabled:opacity-50"
              style={{ minHeight: "1.5rem", maxHeight: "120px" }}
            />
            <button
              onClick={() => sendMessage(input)}
              disabled={isStreaming || !input.trim()}
              className="mb-0.5 flex-shrink-0 rounded-lg bg-sky-500 px-3.5 py-1.5 text-xs font-semibold text-slate-950 transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t("advisorSend")}
            </button>
          </div>
          <p className="mt-1.5 text-center text-[11px] text-slate-700">
            {t("disclaimerTitle")}
          </p>
        </div>
      </div>
    </div>
  );
}
