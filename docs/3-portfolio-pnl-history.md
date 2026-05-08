# Feature: Storico P&L nel Tempo

## Obiettivo

Salvare snapshot periodici del valore di portafoglio per permettere all'utente di vedere come è evoluto il P&L nel tempo su un grafico — indipendentemente dal fatto che apra o meno l'app ogni giorno.

---

## Comportamento atteso

Nella pagina `/portfolio`, sotto la summary bar, aggiungere un grafico a linea che mostra:
- Asse X: data
- Asse Y: valore totale del portafoglio in EUR (o rendimento %)
- Toggle: "Valore assoluto" / "Rendimento %"

```
Portfolio value over time (EUR)
5100 ┤         ╭──╮
5000 ┤    ╭────╯  ╰──
4900 ┤────╯
     └────────────────
     May 7  May 8  May 9
```

---

## Schema DB

Nuovo modello `PortfolioSnapshot`:

```prisma
model PortfolioSnapshot {
  id         String   @id @default(cuid())
  userId     String
  takenAt    DateTime @default(now())
  // JSON array: [{ ticker, currency, shares, purchasePrice, currentPrice }]
  // Stored as string — avoids schema churn as positions change
  data       String
  totalEur   Float    // valore totale convertito in EUR al momento dello snapshot
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, takenAt])
}
```

**Perché JSON nel campo `data`**: le posizioni cambiano nel tempo (add/delete), salvare il dettaglio nel JSON permette di ricostruire la composizione storica senza join complessi.

---

## Quando creare uno snapshot

**Strategia: on-demand con throttle**

Non serve un cron job. Lo snapshot viene creato automaticamente quando l'utente apre `/portfolio`, ma al massimo una volta ogni 24 ore per utente.

Logica in `GET /api/positions`:
```typescript
// Dopo aver restituito le posizioni, crea uno snapshot se l'ultimo è più vecchio di 24h
const lastSnapshot = await db.portfolioSnapshot.findFirst({
  where: { userId: session.user.id },
  orderBy: { takenAt: "desc" },
});
const shouldSnapshot = !lastSnapshot ||
  (Date.now() - lastSnapshot.takenAt.getTime()) > 24 * 60 * 60 * 1000;

if (shouldSnapshot && positions.length > 0) {
  // Fetch prezzi correnti e tasso EUR, crea snapshot in background
  void createSnapshot(session.user.id, positions);
}
```

La funzione `createSnapshot` gira fire-and-forget — non blocca la risposta all'utente.

---

## API

### `GET /api/portfolio/snapshots`
Ritorna gli ultimi N snapshot (default 90 giorni) per l'utente autenticato.

```typescript
// Response
[{
  takenAt: "2026-05-08T10:00:00Z",
  totalEur: 4991.29,
}]
```

### Lib: `lib/portfolio-snapshots.ts`
```typescript
async function createSnapshot(userId: string, positions: Position[]): Promise<void>
async function fetchSnapshots(): Promise<SnapshotPoint[]>
```

---

## UI: Grafico storico

Componente `PortfolioHistoryChart` in `components/portfolio-history-chart.tsx`:

- Usa `Recharts` (già nel progetto) con `LineChart`
- Due serie: `totalEur` e `costBasisEur` (per vedere il breakeven)
- Tooltip con data e valore
- Se < 2 snapshot: mostra messaggio "Il grafico apparirà dopo qualche giorno di utilizzo"

```tsx
<LineChart data={snapshots}>
  <Line dataKey="totalEur" stroke="#38bdf8" name="Portfolio value" />
  <Line dataKey="costBasisEur" stroke="#475569" strokeDasharray="4 2" name="Cost basis" />
</LineChart>
```

---

## File da creare/modificare

| File | Modifica |
|------|----------|
| `prisma/schema.prisma` | Nuovo modello `PortfolioSnapshot` + relazione su `User` |
| `lib/portfolio-snapshots.ts` | **nuovo** — `createSnapshot`, `fetchSnapshots` |
| `app/api/positions/route.ts` | Trigger snapshot fire-and-forget dopo GET |
| `app/api/portfolio/snapshots/route.ts` | **nuovo** — GET snapshots ultimi 90gg |
| `components/portfolio-history-chart.tsx` | **nuovo** — grafico Recharts |
| `app/portfolio/page.tsx` | Aggiungere `<PortfolioHistoryChart />` |
| `types/portfolio.ts` | Aggiungere tipo `SnapshotPoint` |

---

## Considerazioni

- **Privacy**: gli snapshot contengono dati finanziari — assicurarsi che `GET /api/portfolio/snapshots` filtra sempre per `userId`
- **Turso migration**: il modello `PortfolioSnapshot` richiede `npx prisma migrate dev` + apply su Turso
- **Pulizia**: opzionalmente, eliminare snapshot più vecchi di 1 anno per non far crescere il DB indefinitamente
- **Franfurter**: i tassi di cambio al momento dello snapshot vanno salvati nel campo `data` JSON — non ricalcolarli a posteriori perché i tassi cambiano

---

## Verifica

1. Apri `/portfolio` → viene creato il primo snapshot in background
2. Aspetta 24h (o forza con un override nella logica) → secondo snapshot
3. Il grafico appare con la linea del valore e quella del cost basis
4. Il tooltip mostra data + valore EUR
