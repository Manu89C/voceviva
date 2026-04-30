# Modifiche Immediate — Report Settimanale VoceViva

## Obiettivo
Sostituire il singolo prompt del `ReportManager` con una catena di due chiamate LLM in sequenza:
1. **Estrazione fatti strutturati** → JSON
2. **Generazione report** a partire dal JSON (non dalle note grezze)

Questo migliora la qualità del ragionamento senza riscrivere l'architettura esistente.

---

## File da modificare
**`vv-report.js`** — unico file coinvolto.

---

## Modifica 1 — Nuova funzione `_extractFacts()`

Aggiungere questa funzione **prima** di `_callGroqReport()`:

```javascript
async function _extractFacts(notesText) {
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + _groqKey.trim(),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      max_tokens: 1500,
      temperature: 0.1,
      messages: [
        {
          role: 'system',
          content: `Sei un estrattore di fatti da note personali. 
Il tuo unico compito è estrarre informazioni strutturate. 
NON interpretare, NON valutare, NON aggiungere commenti.
Rispondi SOLO con JSON valido, nessun testo fuori dal JSON.

Estrai questo schema per l'intero insieme di note:
{
  "eventi": ["lista di eventi concreti accaduti, uno per riga"],
  "emozioni": [{"emozione": "nome", "contesto": "situazione associata"}],
  "azioni_compiute": ["azioni concrete già fatte"],
  "promises_to_self": ["frasi con intenzione futura in prima persona, es: domani vado, questa settimana inizierò, voglio fare"],
  "persone_menzionate": ["nomi o ruoli di persone citate"],
  "temi_ricorrenti": ["parole o concetti che appaiono in più note"],
  "umore_generale": "una parola sola"
}`
        },
        {
          role: 'user',
          content: 'Estrai i fatti da queste note:\n\n' + notesText
        }
      ]
    })
  });

  if (!res.ok) throw new Error('Estrazione fatti: HTTP ' + res.status);
  const json = await res.json();
  const raw = json.choices?.[0]?.message?.content?.trim() || '';
  
  try {
    // Rimuovi eventuali backtick markdown prima del parse
    const clean = raw.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
    return JSON.parse(clean);
  } catch(e) {
    console.warn('[ReportManager] _extractFacts: JSON parse fallito, uso testo grezzo', e);
    return null;
  }
}
```

---

## Modifica 2 — Aggiornare `_callGroqReport()`

Modificare la funzione esistente per ricevere i fatti estratti e usarli nel prompt.

### Firma attuale:
```javascript
async function _callGroqReport(recentText, recentNotes, historyText = '', totalCount = 0)
```

### Nuova firma:
```javascript
async function _callGroqReport(recentText, recentNotes, historyText = '', totalCount = 0, extractedFacts = null)
```

### Nel corpo della funzione, aggiungere subito dopo `const moodContext = ...`:

```javascript
// Blocco fatti strutturati da inserire nel prompt
const factsBlock = extractedFacts ? `
FATTI ESTRATTI DALLE NOTE (usa questi come base dell'analisi):
- Umore generale: ${extractedFacts.umore_generale || 'non rilevato'}
- Azioni compiute: ${(extractedFacts.azioni_compiute || []).join(' | ') || 'nessuna'}
- Intenzioni dichiarate (promises_to_self): ${(extractedFacts.promises_to_self || []).join(' | ') || 'nessuna'}
- Emozioni: ${(extractedFacts.emozioni || []).map(e => e.emozione + ' (' + e.contesto + ')').join(' | ') || 'nessuna'}
- Temi ricorrenti: ${(extractedFacts.temi_ricorrenti || []).join(', ') || 'nessuno'}
- Persone menzionate: ${(extractedFacts.persone_menzionate || []).join(', ') || 'nessuna'}

DISSONANZE DA VERIFICARE:
Le seguenti intenzioni dichiarate potrebbero non trovare corrispondenza nelle azioni compiute:
${
  (extractedFacts.promises_to_self || []).map(p => {
    const found = (extractedFacts.azioni_compiute || []).some(a =>
      a.toLowerCase().split(' ').some(w => w.length > 4 && p.toLowerCase().includes(w))
    );
    return found ? null : '⚠ "' + p + '" — non risulta tra le azioni compiute';
  }).filter(Boolean).join('\n') || 'Nessuna dissonanza rilevata automaticamente'
}
` : '';
```

### Nel `userPrompt`, aggiungere `factsBlock` prima del testo delle note:

```javascript
const userPrompt = `${historySection}${factsBlock}## FOCUS — ULTIME ${n} NOTE (testo completo per riferimento):
${moodContext}
${recentText}

Genera il report basandoti sui FATTI ESTRATTI sopra. Usa il testo delle note solo per citazioni dirette.`;
```

---

## Modifica 3 — Aggiornare `generateReport()` per chiamare la catena

Nella funzione `generateReport()`, nel blocco che chiama `_callGroqReport`, sostituire:

### Codice attuale:
```javascript
const { html: reportHtml, aiTitle } = await _callGroqReport(
  recentText, recentNotes, historyText, allNotes.length
);
```

### Nuovo codice:
```javascript
// Step 1: Estrai fatti strutturati
let extractedFacts = null;
try {
  extractedFacts = await _extractFacts(recentText);
  console.log('[ReportManager] Fatti estratti:', extractedFacts);
} catch(e) {
  console.warn('[ReportManager] Estrazione fatti fallita, procedo senza:', e);
}

// Step 2: Genera report partendo dai fatti
const { html: reportHtml, aiTitle } = await _callGroqReport(
  recentText, recentNotes, historyText, allNotes.length, extractedFacts
);
```

---

## Modifica 4 — Aggiornare il system prompt di `_callGroqReport`

Nel system prompt esistente, aggiungere questa istruzione all'inizio del blocco `PRINCIPI`:

```
- I FATTI ESTRATTI sopra hanno priorità sulla tua interpretazione diretta delle note
- Le dissonanze segnalate con ⚠ devono essere nominate nel report nella sezione "Quello che non torna"
- Se non ci sono dissonanze segnalate, scrivi esplicitamente "Nessuna incongruenza rilevante questa settimana"
- NON inventare dissonanze che non emergono dai fatti estratti
```

---

## Comportamento atteso dopo le modifiche

1. `generateReport()` chiama prima `_extractFacts()` → ottiene JSON strutturato
2. Il JSON viene passato a `_callGroqReport()` come contesto pre-elaborato
3. Il modello nel secondo step non deve più "leggere" le note — riceve fatti già classificati
4. Le dissonanze tra `promises_to_self` e `azioni_compiute` vengono segnalate automaticamente con `⚠` prima che il modello scriva il report
5. Se `_extractFacts()` fallisce (timeout, parse error), il sistema degrada silenziosamente al comportamento attuale

---

## Note per il LLM che implementa

- Non modificare la firma pubblica di `generateReport()` o `renderReportCard()` — sono chiamate da `index.html`
- Non toccare `_checkAndGenerate()`, `_reportExistsForWeek()`, `_saveReport()`, `_buildReportCard()`
- Il modello usato per l'estrazione fatti è lo stesso (`meta-llama/llama-4-scout-17b-16e-instruct`) — non cambiarlo
- `temperature: 0.1` per l'estrazione fatti è intenzionale — vuoi output deterministico
- Testa con `console.log('[ReportManager] Fatti estratti:', extractedFacts)` per verificare il JSON prima del secondo step
