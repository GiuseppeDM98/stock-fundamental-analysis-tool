# Feature: Collegamento Posizione ↔ Analisi Salvate

## Obiettivo

Quando l'utente guarda una posizione nel portfolio, vuole vedere subito se ha analisi AI salvate per quel ticker — e viceversa, dall'analisi vuole sapere se ha una posizione aperta.

---

## Comportamento atteso

### In `/portfolio`
Per ogni posizione, sotto il P&L, aggiungere un link "N analisi salvate" se esistono analisi per quel ticker:

```
ENI.MI  Eni  [EUR]                              7 mag 2026
221 shares @ €22.585  ·  Cost €4991  ·  Now €22.39  ·  Value €4947
-44,20 € (-0.9%)
2 analisi salvate →                                        [Analyze] [Delete]
```

Cliccando "N analisi salvate" si apre una mini-lista inline (collassabile) con le analisi per quel ticker: data, MoS, fair value base, link alla pagina dettaglio.

### In `/analyses` e `/analyses/[id]`
Se l'utente ha una posizione aperta per quel ticker, mostrare un badge/riga:

```
ENEL.MI  ENEL  MoS 20%
+13.5%  |  Under FV
Posizione aperta: 500 azioni @ €9.40 · P&L +€125 (+2.6%)
```

---

## Implementazione

### Nessuna modifica al DB necessaria
Il collegamento è implicito tramite `ticker` — non serve una foreign key esplicita.

### Lato client: fetch incrociato

**In `portfolio-list.tsx`:**

1. Dopo aver caricato le posizioni, fetch `/api/analyses` (già esistente)
2. Costruire una map `ticker → SavedAnalysis[]`
3. Per ogni posizione, mostrare il count e la mini-lista collassabile

```typescript
// Map ticker → analisi per quel ticker
const analysesByTicker = analyses.reduce((acc, a) => {
  acc[a.ticker] = [...(acc[a.ticker] ?? []), a];
  return acc;
}, {} as Record<string, SavedAnalysis[]>);
```

**In `analyses-list.tsx`:**

1. Fetch `/api/positions` (già esistente)
2. Costruire una map `ticker → Position[]`
3. Per ogni analisi che ha un ticker con posizione aperta, mostrare il badge P&L

### Componente `TickerAnalysesInline`

Nuovo componente (inline, no route) che mostra le analisi per un ticker in formato compatto:

```tsx
function TickerAnalysesInline({ analyses }: { analyses: SavedAnalysis[] }) {
  const [open, setOpen] = useState(false);
  if (analyses.length === 0) return null;

  return (
    <div className="mt-1">
      <button onClick={() => setOpen(o => !o)} className="text-xs text-sky-400 hover:text-sky-300">
        {analyses.length} analisi salvate {open ? "▲" : "▼"}
      </button>
      {open && (
        <ul className="mt-1 space-y-1 pl-2 border-l border-slate-700">
          {analyses.map(a => (
            <li key={a.id} className="text-xs text-slate-400">
              <a href={`/analyses/${a.id}`} className="hover:text-slate-200">
                {formatDate(a.createdAt)} · MoS {a.mosPercent}%
                {a.fairValueBase && ` · FV base ${a.fairValueBase.toFixed(2)}`}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

### Performance
- Entrambi i fetch (`/api/analyses` e `/api/positions`) sono già paginati/limitati per utente
- Nessuna richiesta aggiuntiva: si riutilizzano i dati già caricati dal componente padre
- I due fetch partono in parallelo con `Promise.all`

---

## File da modificare

| File | Modifica |
|------|----------|
| `components/portfolio-list.tsx` | Fetch analisi + map ticker→analyses + `TickerAnalysesInline` |
| `components/analyses-list.tsx` | Fetch posizioni + map ticker→positions + badge posizione aperta |
| `app/analyses/[id]/page.tsx` | Fetch posizione per ticker (server-side, via `db.position.findFirst`) + banner posizione aperta |

---

## Verifica

1. Salva un'analisi per ENI.MI → vai in portfolio → compare "1 analisi salvata"
2. Cliccando espande: data, MoS, fair value, link dettaglio
3. Vai in `/analyses` → la card ENI.MI mostra il badge con la posizione aperta e il P&L corrente
