"use client";

// Typed paste-block editor for the Grounded Deep Value mode — mounted by <DatasetSection>
// on /analyze. Owns the block list (add/edit/remove), a per-ticker localStorage draft, the
// "Prepare data" extraction call, the retry of one failed block, and on "Analyze with
// this data" saves the paste as a financial dataset and hands its id up (onConfirm).
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import ReactDOM from "react-dom";

import { useLanguage } from "@/context/language-context";
import type { Translations } from "@/lib/i18n/translations";
import {
  GROUNDING_BLOCK_KINDS,
  GROUNDING_MAX_BLOCK_CHARS,
  GROUNDING_MAX_BLOCKS,
  GROUNDING_MAX_TOTAL_CHARS,
  type GroundedFinancials,
  type GroundingBlock,
  type GroundingBlockKind,
} from "@/types/grounding";
import { extractGrounding, type GroundingExtractResponse } from "@/lib/grounding-client";
import { createPasteDataset } from "@/lib/dataset-client";
import { chooseStartingBlocks, remapFailedBlockPositions, selectSubmittableBlocks } from "@/lib/grounding-blocks";
import type { BlockExtractResult } from "@/lib/grounding/merge";
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
  // Blocks to start from instead of the local draft ("Refresh data" on a stored dataset);
  // the draft wins when it holds other blocks (chooseStartingBlocks).
  seedBlocks?: GroundingBlock[];
  // The id of the dataset confirmed for the run, if any.
  valueId: string | null;
  // The paste was saved as a dataset: the run can use it.
  onConfirm: (dataset: { id: string; extract: GroundedFinancials }) => void;
  // A block changed: the confirmed dataset no longer matches the editor.
  onInvalidate: () => void;
};

export function GroundingInput({ ticker, seedBlocks, valueId, onConfirm, onInvalidate }: Props) {
  const { t } = useLanguage();

  const [blocks, setBlocks] = useState<GroundingBlock[]>([]);
  // Guards the draft-save effect until THIS ticker's draft has actually been loaded —
  // without it, the effect could fire once with the old ticker's blocks still in state
  // and overwrite the new ticker's draft before it's read (gotcha #21 territory).
  const [hydratedTicker, setHydratedTicker] = useState<string | null>(null);
  const [draftKept, setDraftKept] = useState(false);
  const [expandedBlockId, setExpandedBlockId] = useState<string | null>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  // Viewport coordinates for the portaled menu (see below) — null until computed from
  // the trigger button's own position, right before opening.
  const [addMenuPosition, setAddMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const [view, setView] = useState<"edit" | "preview">("edit");
  const [extractStatus, setExtractStatus] = useState<"idle" | "loading" | "error">("idle");
  const [extractError, setExtractError] = useState<string | null>(null);
  const [extractResult, setExtractResult] = useState<GroundingExtractResponse | null>(null);
  // The exact blocks the current extractResult was produced from — saved with the dataset
  // instead of the live list, which may still hold empty blocks.
  const [extractedBlocks, setExtractedBlocks] = useState<GroundingBlock[]>([]);
  // Per block: its last successful extraction, sent back as a prior result when another
  // block is retried, so only that block runs again. An edit drops the block's result.
  const [blockResults, setBlockResults] = useState<Record<string, BlockExtractResult>>({});
  const [failedBlockIds, setFailedBlockIds] = useState<Set<string>>(new Set());
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [confirmStatus, setConfirmStatus] = useState<"idle" | "saving" | "error">("idle");
  const [confirmError, setConfirmError] = useState<string | null>(null);
  // The dataset this editor saved last: "✓ Ready" in the preview only while it is the run's.
  const [savedId, setSavedId] = useState<string | null>(null);

  // Two separate refs because the menu itself is portaled to document.body (see below)
  // — it's no longer a DOM descendant of the trigger button, so the outside-click check
  // must test against both.
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const textareaRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  // Set by the pencil button: the next render that shows this block's textarea focuses it.
  const pendingFocusIdRef = useRef<string | null>(null);

  // Re-key everything to the current ticker: a different stock is a different (or
  // empty) paste session.
  useEffect(() => {
    const start = chooseStartingBlocks(loadDraftBlocks(ticker), seedBlocks);
    setBlocks(start.blocks);
    setDraftKept(start.draftKept);
    setView("edit");
    setExtractResult(null);
    setExtractedBlocks([]);
    setBlockResults({});
    setFailedBlockIds(new Set());
    setExtractStatus("idle");
    setExtractError(null);
    setConfirmStatus("idle");
    setConfirmError(null);
    setSavedId(null);
    setExpandedBlockId(null);
    setHydratedTicker(ticker);
    // The seed is read once, when the editor opens on a ticker: a later prop change must
    // not overwrite what the user has typed since.
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

  // Any block edit invalidates a previously-confirmed dataset — it was extracted from
  // the blocks as they stood before this change.
  function invalidateConfirmed() {
    if (valueId) onInvalidate();
  }

  function dropResult(id: string) {
    setBlockResults((prev) => {
      if (!(id in prev)) return prev;
      const { [id]: _dropped, ...rest } = prev;
      return rest;
    });
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
    dropResult(id);
    invalidateConfirmed();
  }

  function updateBlockPeerTicker(id: string, peerTicker: string) {
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, peerTicker } : b)));
    dropResult(id);
    invalidateConfirmed();
  }

  function removeBlock(id: string) {
    setBlocks((prev) => prev.filter((b) => b.id !== id));
    setExpandedBlockId((current) => (current === id ? null : current));
    dropResult(id);
    setFailedBlockIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
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
  const busy = extractStatus === "loading" || retryingId !== null || confirmStatus === "saving";
  const canPrepare = submittableBlocks.length > 0 && !overCap && !hasEmptyPeerTicker && !busy;

  /** Shows an extraction response: `ordered` = the submittable blocks, in editor order. */
  function showResult(result: GroundingExtractResponse, ordered: GroundingBlock[]) {
    setBlockResults(Object.fromEntries(result.blockResults.map((r) => [r.blockId, r])));
    setExtractResult({ ...result, warnings: remapFailedBlockPositions(result.warnings, ordered, blocks) });
    setExtractedBlocks(ordered);
    setView("preview");
  }

  async function handlePrepare() {
    const sent = submittableBlocks;
    setExtractStatus("loading");
    setExtractError(null);
    try {
      const result = await extractGrounding(ticker, sent, sent.map((b) => b.id));
      setFailedBlockIds(new Set(result.failedBlockIds));
      showResult(result, sent);
      setExtractStatus("idle");
    } catch (err) {
      setExtractError(err instanceof Error ? err.message : "Extraction failed.");
      setExtractStatus("error");
    }
  }

  async function handleRetry(blockId: string) {
    const ordered = submittableBlocks;
    const blockOrder = ordered.map((b) => b.id);
    // The retried block with its current text — plus any block added or edited since the
    // last extraction (no result, and not a failure of its own): without it the merge
    // would silently miss that block. Every other block goes back as its prior result.
    const sent = ordered.filter((b) => b.id === blockId || (!blockResults[b.id] && !failedBlockIds.has(b.id)));
    const sentIds = new Set(sent.map((b) => b.id));
    setRetryingId(blockId);
    setExtractError(null);
    try {
      const result = await extractGrounding(ticker, sent, blockOrder, {
        priorResults: Object.values(blockResults).filter((r) => blockOrder.includes(r.blockId)),
      });
      setFailedBlockIds(new Set([...[...failedBlockIds].filter((id) => !sentIds.has(id) && blockOrder.includes(id)), ...result.failedBlockIds]));
      showResult(result, ordered);
      invalidateConfirmed();
    } catch (err) {
      setExtractError(err instanceof Error ? err.message : "Extraction failed.");
    } finally {
      setRetryingId(null);
    }
  }

  async function handleConfirm() {
    if (!extractResult) return;
    setConfirmStatus("saving");
    setConfirmError(null);
    try {
      const { id } = await createPasteDataset(ticker, { blocks: extractedBlocks, extract: extractResult.extract }, extractResult.warnings);
      setSavedId(id);
      setConfirmStatus("idle");
      onConfirm({ id, extract: extractResult.extract });
    } catch (err) {
      setConfirmError(err instanceof Error ? err.message : "");
      setConfirmStatus("error");
    }
  }

  const failedBlocks = blocks.flatMap((b, i) => (failedBlockIds.has(b.id) ? [{ id: b.id, position: i + 1 }] : []));
  const retryButton = (id: string) => (
    <button
      onClick={() => handleRetry(id)}
      disabled={busy}
      aria-label={t("datasetRetryBlock")}
      title={t("datasetRetryBlock")}
      className="tap shrink-0 rounded-lg border border-warning/50 px-2 py-1 text-xs text-warning transition hover:border-warning disabled:cursor-not-allowed disabled:opacity-40"
    >
      ↻
    </button>
  );

  return (
    <div className="space-y-3">
      {draftKept && <p className="text-xs text-warning">{t("datasetDraftKept")}</p>}

      {view === "edit" && (
        <>
          {blocks.length === 0 && <p className="text-xs text-slate-500">{t("groundingNoBlocksYet")}</p>}

          <div className="space-y-2">
            {blocks.map((block) => (
              <div key={block.id} className="rounded-lg border border-slate-700/60 bg-slate-900/40 p-2">
                {/* Sibling buttons, never nested (gotcha #24): the label toggles the
                    textarea, the pencil opens and focuses it, ↻ retries a failed block,
                    ✕ removes the block. */}
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
                    {failedBlockIds.has(block.id) && <span className="text-warning"> · {t("groundingWarnBlockExtractFailed")}</span>}
                  </button>
                  {failedBlockIds.has(block.id) && retryButton(block.id)}
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
                    {KIND_HINT_KEY[block.kind] && <p className="text-xs text-muted">{t(KIND_HINT_KEY[block.kind]!)}</p>}
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
        </>
      )}

      {view === "preview" && extractResult && (
        <GroundingPreview
          ticker={ticker}
          result={extractResult}
          confirmed={savedId !== null && savedId === valueId}
          onEdit={() => setView("edit")}
          onConfirm={handleConfirm}
          failedBlocks={failedBlocks}
          onRetry={handleRetry}
          busy={busy}
        />
      )}

      {extractError && (
        <p className="text-xs text-danger">
          {t("groundingExtractErrorPrefix")} {extractError}
        </p>
      )}
      {confirmStatus === "error" && (
        <p className="text-xs text-danger">
          {t("datasetSaveError")}
          {confirmError ? `: ${confirmError}` : ""}
        </p>
      )}
    </div>
  );
}
