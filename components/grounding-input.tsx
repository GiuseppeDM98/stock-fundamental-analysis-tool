"use client";

// Typed paste-block editor for the Grounded Deep Value mode — mounted above
// <DeepValuePanel> on /analyze, inside a collapsible "Pasted data (optional)" section.
// Owns the block list (add/edit/remove), a per-ticker localStorage draft, the
// "Prepare data" extraction call, and hands off a confirmed GroundingPayload to the
// parent via a controlled value/onChange pair (same convention as AiSettingsControl).
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import ReactDOM from "react-dom";

import { useLanguage } from "@/context/language-context";
import type { Translations } from "@/lib/i18n/translations";
import {
  GROUNDING_BLOCK_KINDS,
  GROUNDING_MAX_BLOCK_CHARS,
  GROUNDING_MAX_BLOCKS,
  GROUNDING_MAX_TOTAL_CHARS,
  type GroundingBlock,
  type GroundingBlockKind,
  type GroundingPayload,
} from "@/types/grounding";
import { extractGrounding, type GroundingExtractResponse } from "@/lib/grounding-client";
import { remapFailedBlockPositions, selectSubmittableBlocks } from "@/lib/grounding-blocks";
import { GroundingPreview } from "@/components/report/grounding-preview";

// The caps are enforced server-side too (the client is never trusted); checking them here
// gives immediate feedback instead of a round trip.
const WARN_TOTAL_CHARS = 120000;

// Textarea auto-grow bounds: starts at ~6 lines, grows with the paste, then scrolls — a
// full statement table is hundreds of lines and must not push the Prepare button off-screen.
const TEXTAREA_MIN_HEIGHT_PX = 120;
const TEXTAREA_MAX_HEIGHT_PX = 420;

const KIND_LABEL_KEY: Record<GroundingBlockKind, keyof Translations> = {
  income_statement: "groundingKindIncomeStatement",
  balance_sheet: "groundingKindBalanceSheet",
  cash_flow: "groundingKindCashFlow",
  valuation_multiples: "groundingKindValuationMultiples",
  estimates: "groundingKindEstimates",
  peer_valuation: "groundingKindPeerValuation",
  other: "groundingKindOther",
};

// Per-kind help text shown above the textarea when a block is expanded. Only
// valuation_multiples has one today — it's the single most important paste-time hint:
// without an EV/Revenue or Enterprise Value column, the basis-reconciliation engine
// (lib/grounding/basis.ts) has nothing to compute kE from and degrades to "unavailable"
// for the whole paste, silently. Asking for it here, at paste time, is far cheaper than
// discovering it after a run.
const KIND_HINT_KEY: Partial<Record<GroundingBlockKind, keyof Translations>> = {
  valuation_multiples: "groundingValuationMultiplesHint",
};

/**
 * A monospace textarea that grows with its content between the min/max heights above,
 * then scrolls. Height is recomputed from scrollHeight after every value change — reset to
 * "auto" first, or the box could only ever grow, never shrink back when text is removed.
 */
function AutoGrowTextarea({
  value,
  onChange,
  textareaRef,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  textareaRef: (el: HTMLTextAreaElement | null) => void;
  placeholder: string;
}) {
  const localRef = useRef<HTMLTextAreaElement | null>(null);

  useLayoutEffect(() => {
    const el = localRef.current;
    if (!el) return;
    el.style.height = "auto";
    const height = Math.min(Math.max(el.scrollHeight, TEXTAREA_MIN_HEIGHT_PX), TEXTAREA_MAX_HEIGHT_PX);
    el.style.height = `${height}px`;
    el.style.overflowY = el.scrollHeight > TEXTAREA_MAX_HEIGHT_PX ? "auto" : "hidden";
  }, [value]);

  return (
    <textarea
      ref={(el) => {
        localRef.current = el;
        textareaRef(el);
      }}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      maxLength={GROUNDING_MAX_BLOCK_CHARS}
      placeholder={placeholder}
      style={{ minHeight: TEXTAREA_MIN_HEIGHT_PX, maxHeight: TEXTAREA_MAX_HEIGHT_PX }}
      className="w-full resize-none rounded-lg border border-slate-700 bg-slate-800/60 px-2 py-1.5 font-mono text-xs text-slate-200 focus:border-violet-500 focus:outline-hidden"
    />
  );
}

function loadDraftBlocks(ticker: string): GroundingBlock[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(`sfa:grounding:${ticker}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

type Props = {
  ticker: string;
  value: GroundingPayload | null;
  onChange: (payload: GroundingPayload | null) => void;
};

export function GroundingInput({ ticker, value, onChange }: Props) {
  const { t } = useLanguage();

  const [sectionOpen, setSectionOpen] = useState(false);
  const [blocks, setBlocks] = useState<GroundingBlock[]>([]);
  // Guards the draft-save effect until THIS ticker's draft has actually been loaded —
  // without it, the effect could fire once with the old ticker's blocks still in state
  // and overwrite the new ticker's draft before it's read (gotcha #21 territory).
  const [hydratedTicker, setHydratedTicker] = useState<string | null>(null);
  const [expandedBlockId, setExpandedBlockId] = useState<string | null>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  // Viewport coordinates for the portaled menu (see below) — null until computed from
  // the trigger button's own position, right before opening.
  const [addMenuPosition, setAddMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const [view, setView] = useState<"edit" | "preview">("edit");
  const [extractStatus, setExtractStatus] = useState<"idle" | "loading" | "error">("idle");
  const [extractError, setExtractError] = useState<string | null>(null);
  const [extractResult, setExtractResult] = useState<GroundingExtractResponse | null>(null);
  // The exact blocks the current extractResult was produced from — confirmed into the
  // payload instead of the live list, which may still hold empty blocks the deep-value
  // route's payload schema would reject.
  const [extractedBlocks, setExtractedBlocks] = useState<GroundingBlock[]>([]);

  // Two separate refs because the menu itself is portaled to document.body (see below)
  // — it's no longer a DOM descendant of the trigger button, so the outside-click check
  // must test against both.
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const textareaRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  // Set by the pencil button: the next render that shows this block's textarea focuses it.
  const pendingFocusIdRef = useRef<string | null>(null);

  // Re-key everything to the current ticker: a different stock is a different (or
  // empty) paste session, and any previously-confirmed payload no longer applies to it.
  useEffect(() => {
    setBlocks(loadDraftBlocks(ticker));
    setView("edit");
    setExtractResult(null);
    setExtractedBlocks([]);
    setExtractStatus("idle");
    setExtractError(null);
    setExpandedBlockId(null);
    setHydratedTicker(ticker);
    onChange(null);
    // onChange is a state setter passed fresh each render — depending only on `ticker`
    // avoids re-running this reset on every parent re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker]);

  useEffect(() => {
    if (hydratedTicker !== ticker) return;
    window.localStorage.setItem(`sfa:grounding:${ticker}`, JSON.stringify(blocks));
  }, [blocks, ticker, hydratedTicker]);

  useEffect(() => {
    if (!addMenuOpen) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      if (addButtonRef.current?.contains(target)) return;
      if (addMenuRef.current?.contains(target)) return;
      setAddMenuOpen(false);
    }
    // A scroll would leave the menu visually detached from its trigger (it's fixed-
    // positioned, computed once on open) — closing on scroll is simpler and matches
    // common popover behavior than re-tracking position continuously.
    function handleScroll() {
      setAddMenuOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [addMenuOpen]);

  useEffect(() => {
    const id = pendingFocusIdRef.current;
    if (!id || expandedBlockId !== id) return;
    pendingFocusIdRef.current = null;
    textareaRefs.current[id]?.focus();
  }, [expandedBlockId]);

  function toggleAddMenu() {
    if (!addMenuOpen && addButtonRef.current) {
      const rect = addButtonRef.current.getBoundingClientRect();
      setAddMenuPosition({ top: rect.bottom + 4, left: rect.left });
    }
    setAddMenuOpen((v) => !v);
  }

  // Any block edit invalidates a previously-confirmed payload — it was extracted from
  // the blocks as they stood before this change.
  function invalidateConfirmed() {
    if (value) onChange(null);
  }

  function addBlock(kind: GroundingBlockKind) {
    const block: GroundingBlock = {
      id: crypto.randomUUID(),
      kind,
      text: "",
      ...(kind === "peer_valuation" ? { peerTicker: "" } : {}),
    };
    setBlocks((prev) => [...prev, block]);
    setExpandedBlockId(block.id);
    setAddMenuOpen(false);
    invalidateConfirmed();
  }

  function editBlock(id: string) {
    pendingFocusIdRef.current = id;
    if (expandedBlockId === id) {
      // Already open: the effect above won't re-run, so focus directly.
      pendingFocusIdRef.current = null;
      textareaRefs.current[id]?.focus();
      return;
    }
    setExpandedBlockId(id);
  }

  function updateBlockText(id: string, text: string) {
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, text } : b)));
    invalidateConfirmed();
  }

  function updateBlockPeerTicker(id: string, peerTicker: string) {
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, peerTicker } : b)));
    invalidateConfirmed();
  }

  function removeBlock(id: string) {
    setBlocks((prev) => prev.filter((b) => b.id !== id));
    setExpandedBlockId((current) => (current === id ? null : current));
    invalidateConfirmed();
  }

  const totalChars = blocks.reduce((sum, b) => sum + b.text.length, 0);
  const overCap = totalChars > GROUNDING_MAX_TOTAL_CHARS;
  const nearCap = !overCap && totalChars > WARN_TOTAL_CHARS;
  const atBlockCap = blocks.length >= GROUNDING_MAX_BLOCKS;
  // Empty blocks are skipped rather than sent — they would make the route reject the
  // whole request. Only the blocks that will actually be sent gate the Prepare button.
  const submittableBlocks = selectSubmittableBlocks(blocks);
  const allBlocksEmpty = blocks.length > 0 && submittableBlocks.length === 0;
  const someBlocksEmpty = submittableBlocks.length > 0 && submittableBlocks.length < blocks.length;
  const hasEmptyPeerTicker = submittableBlocks.some((b) => b.kind === "peer_valuation" && !b.peerTicker?.trim());
  const canPrepare = submittableBlocks.length > 0 && !overCap && !hasEmptyPeerTicker && extractStatus !== "loading";

  async function handlePrepare() {
    const sent = submittableBlocks;
    setExtractStatus("loading");
    setExtractError(null);
    try {
      const result = await extractGrounding(ticker, sent);
      setExtractResult({ ...result, warnings: remapFailedBlockPositions(result.warnings, sent, blocks) });
      setExtractedBlocks(sent);
      setView("preview");
      setExtractStatus("idle");
    } catch (err) {
      setExtractError(err instanceof Error ? err.message : "Extraction failed.");
      setExtractStatus("error");
    }
  }

  function handleConfirm() {
    if (!extractResult) return;
    onChange({ blocks: extractedBlocks, extract: extractResult.extract });
  }

  return (
    <div className="card print:hidden">
      {/* Header — the section's own collapse toggle. The "ready" badge sits inside it
          (plain span, not interactive) so gotcha #24 doesn't apply here. */}
      <div className="flex items-center justify-between gap-3">
        <button onClick={() => setSectionOpen((v) => !v)} aria-expanded={sectionOpen} className="min-w-0 flex-1 text-left">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-slate-100">{t("groundingSectionTitle")}</span>
            {value && (
              <span className="shrink-0 rounded-sm bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-success">
                ✓ {t("groundingReadyBadge")}
              </span>
            )}
          </div>
          {!sectionOpen && <p className="mt-0.5 truncate text-xs text-muted">{t("groundingSectionDesc")}</p>}
        </button>
        <button
          onClick={() => setSectionOpen((v) => !v)}
          aria-label={sectionOpen ? t("groundingCollapseSection") : t("groundingExpandSection")}
          className="tap shrink-0 rounded-lg border border-slate-700 px-2 py-1 text-xs text-slate-400 transition hover:border-slate-600 hover:text-slate-200"
        >
          <span className={`inline-block transition-transform duration-150 ${sectionOpen ? "rotate-180" : ""}`}>▾</span>
        </button>
      </div>

      {sectionOpen && (
        <div className="mt-3 space-y-3">
          <p className="text-xs text-muted">{t("groundingSectionDesc")}</p>

          {view === "edit" && (
            <>
              {blocks.length === 0 && <p className="text-xs text-slate-500">{t("groundingNoBlocksYet")}</p>}

              <div className="space-y-2">
                {blocks.map((block) => (
                  <div key={block.id} className="rounded-lg border border-slate-700/60 bg-slate-900/40 p-2">
                    {/* Sibling buttons, never nested (gotcha #24): the label toggles the
                        textarea, the pencil opens and focuses it, ✕ removes the block. */}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setExpandedBlockId((id) => (id === block.id ? null : block.id))}
                        className="min-w-0 flex-1 text-left text-xs text-slate-200"
                      >
                        {t(KIND_LABEL_KEY[block.kind])}
                        {block.kind === "peer_valuation" && block.peerTicker ? ` — ${block.peerTicker}` : ""}
                        {" · "}
                        {block.text.length.toLocaleString()} {t("groundingCharsSuffix")}
                        {!block.text.trim() && <span className="text-muted"> · {t("groundingBlockEmptyTag")}</span>}
                      </button>
                      <button
                        onClick={() => editBlock(block.id)}
                        aria-label={t("groundingEditBlock")}
                        title={t("groundingEditBlock")}
                        className="tap shrink-0 rounded-lg border border-slate-700 px-2 py-1 text-xs text-slate-400 transition hover:border-slate-600 hover:text-slate-200"
                      >
                        ✎
                      </button>
                      <button
                        onClick={() => removeBlock(block.id)}
                        aria-label={t("groundingRemoveBlock")}
                        className="tap shrink-0 rounded-lg border border-slate-700 px-2 py-1 text-xs text-slate-400 transition hover:border-red-800 hover:text-red-400"
                      >
                        ✕
                      </button>
                    </div>

                    {expandedBlockId === block.id && (
                      <div className="mt-2 space-y-2">
                        {KIND_HINT_KEY[block.kind] && (
                          <p className="text-xs text-muted">{t(KIND_HINT_KEY[block.kind]!)}</p>
                        )}
                        {block.kind === "peer_valuation" && (
                          <input
                            type="text"
                            value={block.peerTicker ?? ""}
                            onChange={(e) => updateBlockPeerTicker(block.id, e.target.value.toUpperCase())}
                            placeholder={t("groundingPeerTickerPlaceholder")}
                            className="w-full rounded-lg border border-slate-700 bg-slate-800/60 px-2 py-1.5 text-xs text-slate-200 focus:border-violet-500 focus:outline-hidden"
                          />
                        )}
                        <AutoGrowTextarea
                          value={block.text}
                          onChange={(text) => updateBlockText(block.id, text)}
                          textareaRef={(el) => {
                            textareaRefs.current[block.id] = el;
                          }}
                          placeholder={t("groundingTextareaPlaceholder")}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <button
                ref={addButtonRef}
                onClick={toggleAddMenu}
                disabled={atBlockCap}
                className="tap rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-200 transition hover:border-slate-400 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t("groundingAddBlockBtn")} ▾
              </button>
              {/* Portaled to <body>: `.card`'s backdrop-blur-sm creates its own stacking
                  context, so an absolutely-positioned menu confined to this card can
                  render BEHIND a later sibling card (e.g. the Deep Value panel) no
                  matter its z-index (AGENTS.md › Modals/Overlays). Fixed-positioned at
                  the trigger's own viewport coordinates instead. */}
              {addMenuOpen &&
                addMenuPosition &&
                ReactDOM.createPortal(
                  <div
                    ref={addMenuRef}
                    style={{ top: addMenuPosition.top, left: addMenuPosition.left }}
                    className="fixed z-50 w-56 rounded-lg border border-slate-700 bg-slate-800 py-1 shadow-lg"
                  >
                    {GROUNDING_BLOCK_KINDS.map((kind) => (
                      <button
                        key={kind}
                        onClick={() => addBlock(kind)}
                        className="block w-full px-3 py-1.5 text-left text-xs text-slate-200 hover:bg-slate-700/60"
                      >
                        {t(KIND_LABEL_KEY[kind])}
                      </button>
                    ))}
                  </div>,
                  document.body
                )}

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800/60 pt-3">
                <p className={`text-xs ${overCap ? "text-danger" : nearCap ? "text-warning" : "text-muted"}`}>
                  {totalChars.toLocaleString()} {t("groundingCharsSuffix")}
                  {overCap && ` — ${t("groundingCapExceeded")}`}
                  {nearCap && ` — ${t("groundingLargeWarning")}`}
                </p>
                <button
                  onClick={handlePrepare}
                  disabled={!canPrepare}
                  className="tap rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {extractStatus === "loading" ? t("groundingPreparingState") : t("groundingPrepareBtn")}
                </button>
              </div>

              {allBlocksEmpty && <p className="text-xs text-warning">{t("groundingAllBlocksEmpty")}</p>}
              {someBlocksEmpty && <p className="text-xs text-muted">{t("groundingEmptyBlocksSkipped")}</p>}
              {hasEmptyPeerTicker && <p className="text-xs text-warning">{t("groundingPeerTickerRequired")}</p>}
              {extractStatus === "error" && extractError && (
                <p className="text-xs text-danger">
                  {t("groundingExtractErrorPrefix")} {extractError}
                </p>
              )}
            </>
          )}

          {view === "preview" && extractResult && (
            <GroundingPreview
              ticker={ticker}
              result={extractResult}
              confirmed={value !== null}
              onEdit={() => setView("edit")}
              onConfirm={handleConfirm}
            />
          )}
        </div>
      )}
    </div>
  );
}
