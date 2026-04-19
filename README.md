# VoceViva – Questionario & Diario

App web PWA per annotazioni vocali/testuali e diario guidato, con trascrizione Whisper (Groq), elaborazione LLM (LLaMA), storage Supabase e memoria RAG vettoriale (Cohere).

---

## Architettura

| File | Ruolo |
|---|---|
| `index.html` | Pagina principale: card API, FAB "+", lista annotazioni con card Report e In Sospeso |
| `freeNote_func.html` | Pagina dedicata alla Nota Libera (overlay fullscreen) |
| `guidedDiary_func.html` | Pagina dedicata al Diario Guidato (overlay fullscreen) |
| `to_complete.html` | Pagina dedicata alle risposte "In Sospeso" (domande saltate) |
| `diary.html` | Visualizzazione diario: calendario e cronologia |
| `vv-memory.js` | MemoryManager – embedding Cohere, RAG retrieval, Dissonance Engine |
| `vv-profile.js` | Gestione profilo utente |
| `vv-report.js` | ReportManager – generazione e visualizzazione Report Settimanale |
| `rnnoise-sync.js` | Noise suppression per registrazione vocale |
| `sw.js` | Service Worker per funzionamento offline |
| `manifest.json` | Manifest PWA |

## Stack & API

- **Groq** – Whisper (trascrizione audio) + LLaMA 4 Scout `meta-llama/llama-4-scout-17b-16e-instruct` (report settimanale, titoli, dissonanze)
- **Cohere** – `embed-multilingual-v3.0` (1024 dim) per vettorializzazione note
- **Supabase** – PostgreSQL + pgvector per storage note e ricerca semantica (`match_notes` RPC)
- **MediaRecorder** – Registrazione audio in-browser
- **RNNoise** – Soppressione rumore in tempo reale

## Funzionalità

### Navigazione (aggiornata)
- `index.html` è il punto di partenza: mostra la card API, il FAB "+" e la lista annotazioni
- Il FAB "+" si espande in due pulsanti: **Diario Guidato** → naviga a `guidedDiary_func.html`, **Nota Libera** → naviga a `freeNote_func.html`
- Entrambe le pagine vengono prefetchate a idle e su hover/touch del FAB per ridurre la latenza di navigazione

### Nota Libera (`freeNote_func.html`)
- Editor contenteditable con toolbar di formattazione (H1, H2, H3, Bold, Italic, UL, OL)
- Registrazione vocale con trascrizione Whisper
- Foto OCR
- Layout fullscreen a overlay (stesso stile del diario guidato)
- Modalità compatta da tastiera: l'header si riduce quando la tastiera virtuale è aperta
- Salvataggio su Supabase + vettorializzazione automatica

### Diario Guidato (`guidedDiary_func.html`)
- Pagina dedicata a schermo intero (non più popup in `index.html`)
- Domande guidate con mood selector a 5 livelli (SVG custom: molto basso, basso, neutro, buono, ottimo)
- Registrazione vocale per ogni risposta (microfono inline nella barra di navigazione)
- FAB REC flottante: appare in basso a destra quando la tastiera è aperta e si fa scroll
- Modalità compatta da tastiera: header ridotto (titolo, progresso e mood nascosti), editor espanso
- Frecce di navigazione prev/next per spostarsi tra le domande già risposte
- Pulsante "Rispondi dopo" (giallo) per saltare una domanda
- Pannello **Impostazioni domande**: modifica, aggiunge, elimina e riordina le domande via drag & drop; modifiche salvate in localStorage
- Selettore data modificabile (`color-scheme:dark`)
- Chiusura con X preserva risposte parziali (salva come "In sospeso")
- Resume: riapertura di una sessione in sospeso tramite `?resume_pending=1`
- Salvataggio + vettorializzazione RAG automatica

### In Sospeso (`to_complete.html`)
- Pagina dedicata che elenca le sessioni di diario guidato non completate
- Click su una card ripristina la sessione salvata e naviga a `guidedDiary_func.html?resume_pending=1`
- Pulsante "✕" per scartare una sessione in sospeso
- Contatore badge con numero di sessioni pendenti

### Report Settimanale (`vv-report.js` — `ReportManager`)
- **Trigger automatico**: ogni domenica alle 08:00 locali (controllo ogni ora via `setInterval`)
- **Anti-duplicato**: controlla localStorage e Supabase prima di generare; lock cross-tab (90 s) per evitare doppia generazione da più finestre/dispositivi; protezione TOCTOU (secondo check prima del salvataggio)
- **Contesto di analisi**:
  - *Focus*: ultime 7 note (write/ai/rec) analizzate in dettaglio
  - *Storico*: fino a 200 note precedenti compresse per mese, passate come contesto al modello
- **Struttura del report** (HTML generato da Groq):
  - Titolo AI (max 6 parole)
  - Com'è andata · Cosa ha funzionato · Cosa non ha funzionato · Quello che non torna · Pattern nel tempo · Da qui
- **Dati umore**: estrae i valori mood registrati nel diario guidato e li include nel contesto AI
- **Salvataggio**: nota Supabase con `mode = 'report'`; dispatcha evento `vv:reportReady`
- **Card in Annotazioni**: etichetta azzurra (`#38bdf8`), titolo e anteprima; inserita sopra le card "In sospeso"; visibile solo per report degli ultimi 14 giorni
- **Bottom sheet**: click sulla card apre un modale a schermo intero con il contenuto completo
- **Eliminazione**: pulsante "✕" sulla card elimina il report da Supabase e resetta il localStorage

### Memoria RAG
- Ogni nota (libera e guidata) viene embeddata via Cohere e salvata come vettore pgvector
- `getContext()` recupera note simili per cosine similarity (threshold 0.3)
- Dissonance Engine rileva contraddizioni tra obiettivi dichiarati e note recenti
- Le note con `mode = 'report'` sono escluse da ogni analisi RAG

### Visualizzazione Diario (`diary.html`)
- Vista calendario con heatmap attività
- Vista cronologia (lista)
- Switcher vista centrato e full-width sotto l'header

---

## Changelog UI

### Interfaccia principale (`index.html`)
- **Ristrutturazione layout**: solo API card + pulsante FAB "+" visibili all'avvio
- **Switcher FAB**: il "+" si espande in due opzioni [Diario Guidato] / [Nota Libera]
- **Navigazione a pagina**: Nota Libera e Diario Guidato sono ora pagine separate (non overlay inline)
- **Prefetch**: le pagine target vengono prefetchate a idle e su hover/touch per navigazione istantanea
- **Card Report Settimanale**: inserita in cima alla lista annotazioni (sopra "In sospeso"), etichetta azzurra
- **Mode switcher iconico**: icone matita (annotazioni) / libro (diario) nell'header

### Diario Guidato (`guidedDiary_func.html`)
- **Pagina dedicata**: non più popup in `index.html`
- **Pannello Impostazioni domande**: drag & drop per riordinare, aggiunta e cancellazione domande
- **FAB REC flottante**: visibile su scroll quando la tastiera è aperta
- **Modalità compatta tastiera**: header si riduce, editor si espande
- **Frecce prev/next**: navigazione tra domande già risposte senza perdere il testo
- **Rimosso pulsante "Salta"**: sostituito da "Rispondi dopo" (giallo)
- **Data modificabile**: input date con `color-scheme:dark`
- **Testo domanda**: 1.45rem
- **Mood selector**: 5 SVG custom colorati per livello (indigo/blue/slate/amber/green)
- **Mic inline**: microfono nella barra di navigazione (non separato)

### Nota Libera (`freeNote_func.html`)
- **Pagina dedicata**: layout fullscreen a overlay
- **Modalità compatta tastiera**: header si riduce quando la tastiera è aperta

### Diario (`diary.html`)
- **Mode switcher iconico**: icone matita/libro nell'header
- **View switcher centrato**: calendario/cronologia full-width sotto l'header, icone 18px
