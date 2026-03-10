"use client";

// AI Analysis Panel — streams a Claude-generated investment report.
// Shows a "Generate AI Analysis" button. On click, POSTs to /api/ai/analyze
// and reads the response as a text stream, rendering Markdown in real-time.
// After completion, lets the user save the report to their account.
import { useState, useRef } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { saveAnalysis } from "@/lib/analyses";
import type { ScenariosInput } from "@/types/valuation";

type Props = {
  ticker: string | null;
  mosPercent: number;
  scenarios: ScenariosInput;
  companyName?: string;
};

type Status = "idle" | "loading" | "streaming" | "done" | "error";

/**
 * Streams the AI analysis from /api/ai/analyze and renders it with react-markdown.
 *
 * Streaming pattern:
 * 1. POST request with ticker, mosPercent, scenarios
 * 2. Read response.body as a ReadableStream
 * 3. Decode each chunk and append to report state
 * 4. react-markdown re-renders on each state update
 */
const LANGUAGES = [
  { value: "English", label: "🇬🇧 English" },
  { value: "Italiano", label: "🇮🇹 Italiano" },
  { value: "Español", label: "🇪🇸 Español" },
  { value: "Français", label: "🇫🇷 Français" },
  { value: "Deutsch", label: "🇩🇪 Deutsch" },
  { value: "Português", label: "🇵🇹 Português" },
  { value: "中文", label: "🇨🇳 中文" },
  { value: "日本語", label: "🇯🇵 日本語" },
];

export default function AiAnalysisPanel({ ticker, mosPercent, scenarios, companyName }: Props) {
  const { data: session } = useSession();
  const router = useRouter();

  const [language, setLanguage] = useState("English");
  const [report, setReport] = useState<string>("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  // Abort controller ref to allow cancelling an in-progress stream.
  const abortRef = useRef<AbortController | null>(null);

  async function handleGenerate() {
    if (!ticker) return;

    // Redirect to login if not authenticated.
    if (!session) {
      router.push("/login");
      return;
    }

    // Cancel any ongoing stream before starting a new one.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setReport("");
    setStatus("loading");
    setErrorMsg(null);
    setSaveStatus("idle");

    try {
      const res = await fetch("/api/ai/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker, mosPercent, scenarios, language }),
        signal: controller.signal,
      });

      if (res.status === 401) {
        router.push("/login");
        return;
      }

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }

      if (!res.body) throw new Error("No response stream");

      setStatus("streaming");

      // Read the plain-text stream and append each chunk to state.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let done = false;

      while (!done) {
        const { value, done: streamDone } = await reader.read();
        done = streamDone;
        if (value) {
          setReport((prev) => prev + decoder.decode(value, { stream: !streamDone }));
        }
      }

      setStatus("done");
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        setStatus("idle");
        return;
      }
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong");
      setStatus("error");
    }
  }

  async function handleSave() {
    if (!ticker || !report) return;

    setSaveStatus("saving");
    try {
      await saveAnalysis({
        ticker,
        companyName: companyName ?? ticker,
        reportMd: report,
        mosPercent,
      });
      setSaveStatus("saved");
    } catch (err) {
      console.error("Save failed:", err);
      setSaveStatus("error");
    }
  }

  const isStreaming = status === "loading" || status === "streaming";

  return (
    <div className="card space-y-4">
      {/* Header row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">AI Analysis</h2>
          <p className="text-sm text-slate-400">
            Claude Sonnet 4.6 with web search — comprehensive investment report
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Language selector — compact dropdown, no dialog needed */}
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            disabled={isStreaming}
            className="rounded-lg border border-slate-700 bg-slate-800/60 px-2 py-2 text-sm text-slate-200 focus:border-sky-500 focus:outline-none disabled:opacity-50"
            aria-label="Report language"
          >
            {LANGUAGES.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>

          <button
            onClick={handleGenerate}
            disabled={!ticker || isStreaming}
            className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-400 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isStreaming ? (
              <span className="flex items-center gap-2">
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                {status === "loading" ? "Starting…" : "Generating…"}
              </span>
            ) : (
              "Generate AI Analysis"
            )}
          </button>
        </div>
      </div>

      {/* Auth hint for logged-out users */}
      {!session && ticker && (
        <p className="rounded-lg bg-sky-500/10 px-3 py-2 text-sm text-sky-300">
          <button onClick={() => router.push("/login")} className="underline hover:no-underline">
            Sign in
          </button>{" "}
          to generate AI analyses and save your reports.
        </p>
      )}

      {/* Error state */}
      {status === "error" && errorMsg && (
        <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">
          {errorMsg}
        </p>
      )}

      {/* Streaming/done report — rendered as Markdown */}
      {report && (
        <div className="rounded-xl border border-slate-700/60 bg-slate-900/50 p-5">
          {/* Blinking cursor while streaming */}
          {isStreaming && (
            <span className="mb-2 inline-block h-3 w-1.5 animate-pulse bg-sky-400" />
          )}

          <div className="prose prose-invert prose-sm max-w-none prose-headings:text-slate-100 prose-p:text-slate-300 prose-strong:text-slate-100 prose-li:text-slate-300 prose-a:text-sky-400">
            <ReactMarkdown>{report}</ReactMarkdown>
          </div>
        </div>
      )}

      {/* Save / navigation controls — show after streaming completes */}
      {status === "done" && report && (
        <div className="flex items-center gap-3 pt-1">
          <button
            onClick={handleSave}
            disabled={saveStatus === "saving" || saveStatus === "saved"}
            className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200 transition hover:border-slate-400 hover:text-slate-100 disabled:opacity-50"
          >
            {saveStatus === "saving" && "Saving…"}
            {saveStatus === "saved" && "✓ Saved"}
            {saveStatus === "error" && "Retry save"}
            {saveStatus === "idle" && "Save Report"}
          </button>

          {saveStatus === "saved" && (
            <button
              onClick={() => router.push("/analyses")}
              className="text-sm text-sky-400 hover:text-sky-300"
            >
              View Saved Analyses →
            </button>
          )}

          {saveStatus === "error" && (
            <p className="text-sm text-red-400">Failed to save. Please try again.</p>
          )}
        </div>
      )}
    </div>
  );
}
