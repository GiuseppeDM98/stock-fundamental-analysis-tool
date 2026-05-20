"use client";

import { useState, useRef } from "react";
import { useLanguage } from "@/context/language-context";

type CompareTickerInputProps = {
  tickers: string[];
  onAdd: (ticker: string) => void;
  onRemove: (ticker: string) => void;
  disabled?: boolean;
};

export function CompareTickerInput({
  tickers,
  onAdd,
  onRemove,
  disabled,
}: CompareTickerInputProps) {
  const { t } = useLanguage();
  const [inputVisible, setInputVisible] = useState(false);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const atMax = tickers.length >= 5;

  function showInput() {
    setInputVisible(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function submit() {
    const ticker = value.trim().toUpperCase();
    if (ticker && !tickers.includes(ticker)) {
      onAdd(ticker);
    }
    setValue("");
    setInputVisible(false);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Existing ticker pills */}
      {tickers.map((ticker) => (
        <span
          key={ticker}
          className="flex items-center gap-1.5 rounded-full border border-slate-600 bg-slate-800 px-3 py-1 text-sm font-medium text-slate-100"
        >
          {ticker}
          <button
            onClick={() => onRemove(ticker)}
            disabled={disabled}
            aria-label={`Remove ${ticker}`}
            className="ml-0.5 text-slate-400 transition hover:text-rose-400 disabled:opacity-40"
          >
            ×
          </button>
        </span>
      ))}

      {/* Inline input when adding */}
      {inputVisible ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="flex items-center gap-1"
        >
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value.toUpperCase())}
            onBlur={submit}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setValue("");
                setInputVisible(false);
              }
            }}
            placeholder="AAPL"
            maxLength={12}
            className="w-24 rounded-lg border border-sky-500 bg-slate-900 px-2 py-1 text-sm font-medium text-slate-100 outline-none"
          />
        </form>
      ) : (
        !atMax && (
          <button
            onClick={showInput}
            disabled={disabled}
            className="rounded-full border border-dashed border-slate-600 px-3 py-1 text-sm text-muted transition hover:border-sky-500 hover:text-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("compareAddTicker")}
          </button>
        )
      )}

      {atMax && (
        <span className="text-xs text-muted">{t("compareMaxTickers")}</span>
      )}
    </div>
  );
}
