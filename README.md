# VoceViva – Questionario & Diario

App web PWA per annotazioni vocali/testuali e diario guidato, con trascrizione Whisper (Groq), elaborazione LLM (LLaMA), storage Supabase e memoria RAG vettoriale (Cohere).

---

## Architettura

| File | Ruolo |
|---|---|
| `index.html` | Pagina principale: annotazioni (nota libera) + diario guidato (popup fullscreen) |
| `diary.html` | Visualizzazione diario: calendario e cronologia |
| `vv-memory.js` | MemoryManager – embedding Cohere, RAG retrieval, Dissonance Engine |
| `vv-profile.js` | Gestione profilo utente |
| `rnnoise-sync.js` | Noise suppression per registrazione vocale |
| `sw.js` | Service Worker per funzionamento offline |
| `manifest.json` | Manifest PWA |

## Stack & API

- **Groq** – Whisper (trascrizione audio) + LLaMA (elaborazione testo, titoli, dissonanze)
- **Cohere** – `embed-multilingual-v3.0` (1024 dim) per vettorializzazione note
- **Supabase** – PostgreSQL + pgvector per storage note e ricerca semantica (`match_notes` RPC)
- **MediaRecorder** – Registrazione audio in-browser
- **RNNoise** – Soppressione rumore in tempo reale

## Funzionalità

### Nota Libera
- Editor contenteditable con formattazione
- Registrazione vocale con trascrizione Whisper
- Foto OCR
- Salvataggio su Supabase + vettorializzazione automatica

### Diario Guidato
- 8 domande guidate con mood selector (emoji)
- Registrazione vocale per ogni risposta
- Popup fullscreen con navigazione avanti/indietro
- Selettore data modificabile
- Pulsante "Rispondi dopo" (giallo) per saltare domande
- Chiusura con X preserva risposte precedenti (nessun dialogo di conferma)
- Salvataggio + vettorializzazione RAG automatica

### Memoria RAG
- Ogni nota (libera e guidata) viene embeddata via Cohere e salvata come vettore pgvector
- `getContext()` recupera note simili per cosine similarity (threshold 0.3)
- Dissonance Engine rileva contraddizioni tra obiettivi dichiarati e note recenti

### Visualizzazione Diario (`diary.html`)
- Vista calendario con heatmap attività
- Vista cronologia (lista)
- Switcher vista centrato e full-width sotto l'header

---

## Changelog UI (sessione corrente)

### Interfaccia principale (`index.html`)
- **Ristrutturazione layout**: solo API card + pulsante FAB "+" visibili all'avvio
- **Switcher FAB**: il "+" si espande in due opzioni [Diario Guidato] / [Nota Libera]
- **Pulsante indietro**: torna dalla nota libera alla vista iniziale
- **Spaziatura**: 24px di margine tra API card e FAB
- **Mode switcher iconico**: icone matita (annotazioni) / libro (diario) nell'header, al posto dei testi

### Diario Guidato
- **Popup fullscreen**: overlay a schermo intero
- **Rimosso pulsante "Salta"**: sostituito da "Rispondi dopo" (giallo)
- **Fix chiusura X**: chiude senza dialogo di conferma, preserva risposte precedenti
- **Data modificabile**: input date nel popup (con `color-scheme:dark` per visibilità)
- **Testo domanda ingrandito**: 1.45rem
- **Pulsante continua**: freccia → per avanti, ✓ per ultima domanda
- **Dimensione bottoni uniforme**: flex uguale per tutti i pulsanti navigazione

### Diario (`diary.html`)
- **Mode switcher iconico**: come in index.html (matita/libro)
- **View switcher centrato**: calendario/cronologia full-width sotto l'header, icone 18px
