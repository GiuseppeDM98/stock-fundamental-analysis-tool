# Feature: Più Acquisti per Ticker — Prezzo Medio di Carico

## Obiettivo

Permettere di registrare più acquisti sullo stesso ticker nel tempo (piani di accumulo, DCA) e calcolare automaticamente il prezzo medio ponderato di carico (WAC — Weighted Average Cost).

---

## Comportamento atteso

### Aggiungere più acquisti
Stesso form attuale — l'utente aggiunge una posizione ENI.MI più volte con date e prezzi diversi. Non serve un'interfaccia speciale: ogni acquisto è una riga separata nel DB.

### Vista aggregata per ticker
Nella pagina `/portfolio`, raggruppare le posizioni per ticker e mostrare una **riga aggregata** con:

```
ENI.MI  Eni  [EUR]
  ├─ 221 shares @ €22.585  (7 mag 2026)
  ├─ 150 shares @ €21.90   (15 giu 2026)
  └─ Totale: 371 shares · WAC €22.31 · Cost €8276 · Value €8412 · +€136 (+1.6%)
```

Toggle "Vista aggregata / Vista per acquisto" per passare tra le due visualizzazioni.

---

## Calcolo WAC (Weighted Average Cost)

```
WAC = Σ(prezzo_i × shares_i) / Σ(shares_i)
```

Esempio:
- Acquisto 1: 221 azioni @ €22.585 → costo €4991.29
- Acquisto 2: 150 azioni @ €21.90  → costo €3285.00
- WAC = (4991.29 + 3285.00) / (221 + 150) = €22.31
- Total shares: 371
- Total cost: €8276.29
- P&L: (prezzo_corrente - WAC) × total_shares

---

## Implementazione

### Nessuna modifica al DB necessaria
Il modello `Position` attuale supporta già più righe per lo stesso ticker. Il raggruppamento avviene lato client.

### Logica di aggregazione (client-side)

```typescript
type AggregatedPosition = {
  ticker: string;
  companyName: string;
  currency: string;
  totalShares: number;
  weightedAvgCost: number;  // WAC
  totalCost: number;
  purchases: Position[];    // singoli acquisti
};

function aggregateByTicker(positions: Position[]): AggregatedPosition[] {
  const map = new Map<string, Position[]>();
  for (const p of positions) {
    map.set(p.ticker, [...(map.get(p.ticker) ?? []), p]);
  }

  return [...map.entries()].map(([ticker, purchases]) => {
    const totalShares = purchases.reduce((s, p) => s + p.shares, 0);
    const totalCost = purchases.reduce((s, p) => s + p.purchasePrice * p.shares, 0);
    const wac = totalCost / totalShares;
    return {
      ticker,
      companyName: purchases[0].companyName,
      currency: purchases[0].currency,
      totalShares,
      weightedAvgCost: wac,
      totalCost,
      purchases: purchases.sort((a, b) =>
        new Date(a.purchasedAt).getTime() - new Date(b.purchasedAt).getTime()
      ),
    };
  });
}
```

### UI: lista aggregata con drill-down

```tsx
function AggregatedPositionRow({ agg, currentPrice }: { agg: AggregatedPosition; currentPrice?: number }) {
  const [expanded, setExpanded] = useState(false);
  const currentValue = currentPrice != null ? currentPrice * agg.totalShares : null;
  const pnl = currentValue != null ? currentValue - agg.totalCost : null;

  return (
    <li className="card">
      {/* Riga sommario */}
      <div className="flex items-center justify-between">
        <button onClick={() => setExpanded(e => !e)} className="flex-1 text-left">
          <span className="font-mono text-sky-400">{agg.ticker}</span>
          <span className="text-xs text-slate-500 ml-2">{agg.totalShares} shares · WAC {formatPrice(agg.weightedAvgCost, agg.currency)}</span>
          {pnl != null && <PnlBadge pnl={pnl} returnPct={(currentValue! / agg.totalCost - 1) * 100} currency={agg.currency} />}
        </button>
        <span className="text-xs text-slate-600">{agg.purchases.length > 1 ? `${expanded ? "▲" : "▼"} ${agg.purchases.length} acquisti` : ""}</span>
      </div>

      {/* Drill-down: singoli acquisti */}
      {expanded && agg.purchases.length > 1 && (
        <ul className="mt-2 space-y-1 pl-4 border-l border-slate-700">
          {agg.purchases.map(p => (
            <li key={p.id} className="flex items-center justify-between text-xs text-slate-400">
              <span>{formatDate(p.purchasedAt)} · {p.shares} @ {formatPrice(p.purchasePrice, p.currency)}</span>
              <button onClick={() => handleDelete(p.id)} className="text-red-400/60 hover:text-red-400">×</button>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
```

### Summary bar
Aggiornare `SummaryBar` per ricevere le posizioni aggregate invece di quelle flat — i calcoli restano identici (si usa `totalCost` e `totalShares × currentPrice`).

---

## Toggle vista

Aggiungere in cima alla lista un toggle con due opzioni:
- **Aggregata** (default): una riga per ticker con WAC e drill-down
- **Per acquisto**: lista flat attuale (utile per vedere date e prezzi individuali)

```tsx
const [viewMode, setViewMode] = useState<"aggregated" | "flat">("aggregated");
```

---

## File da modificare

| File | Modifica |
|------|----------|
| `components/portfolio-list.tsx` | Funzione `aggregateByTicker`, componente `AggregatedPositionRow`, toggle vista |
| `types/portfolio.ts` | Aggiungere tipo `AggregatedPosition` |

**Nessuna modifica a DB, API, o migration necessaria.**

---

## Considerazioni

- **Valuta mista**: se l'utente ha due acquisti di ENI.MI con valute diverse (improbabile ma possibile), usare la valuta del primo acquisto per il WAC e mostrare un warning
- **Delete singolo acquisto**: in vista drill-down, il bottone delete rimuove il singolo acquisto — il WAC si ricalcola automaticamente con gli acquisti rimanenti
- **Prezzo di vendita**: questa feature non gestisce le vendite — sarebbe una feature separata ("Close position")

---

## Verifica

1. Aggiungere due acquisti per ENI.MI a prezzi diversi
2. La lista mostra una sola riga aggregata con il WAC corretto
3. Cliccando espande i due acquisti individuali con data e prezzo
4. Il P&L è calcolato sul WAC, non sul prezzo del singolo acquisto
5. Toggle "Per acquisto" mostra le due righe separate come prima
