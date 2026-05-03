/**
 * vv-report.js — VoceViva Weekly Report v1
 * ─────────────────────────────────────────────────────────────────────────────
 * Genera e visualizza il Report Settimanale nella sezione Annotazioni.
 *
 * COSA FA:
 *   1. Ogni domenica mattina (08:00) genera automaticamente il report
 *   2. Analizza TUTTE le note della settimana (mode: write, ai, rec)
 *   3. Produce un'analisi con: umore, pattern, dissonanze, suggerimenti
 *   4. Salva il report in Supabase (mode: 'report')
 *   5. Mostra la card "Report Settimanale" in cima alle Annotazioni
 *      con etichetta azzurra, sopra le card "In sospeso"
 *
 * INTEGRAZIONE IN index.html:
 *   1. Aggiungi DOPO vv-memory.js:
 *      <script src="vv-report.js"></script>
 *
 *   2. Chiama ReportManager.init() dopo MemoryManager.init():
 *      await ReportManager.init(sb, GROQ_KEY);
 *
 *   3. Nel punto dove carichi le Annotazioni (renderNotesList o equivalente),
 *      chiama prima:
 *      await ReportManager.renderReportCard(container);
 *      dove container è l'elemento DOM delle Annotazioni.
 *
 * SUPABASE:
 *   Nessuna tabella aggiuntiva richiesta.
 *   Il report viene salvato nella tabella 'notes' esistente con mode = 'report'.
 *   Per evitare duplicati, viene controllato se esiste già un report
 *   per la settimana corrente prima di generarne uno nuovo.
 */

const ReportManager = (() => {

  // ── COSTANTI ─────────────────────────────────────────────────────────────────
  const GROQ_URL       = 'https://api.groq.com/openai/v1/chat/completions';
  const REPORT_MODEL   = 'meta-llama/llama-4-scout-17b-16e-instruct';
  const REPORT_MODE    = 'report';
  const CHECK_INTERVAL     = 60 * 60 * 1000; // controlla ogni ora
  const TRIGGER_HOUR       = 8;              // domenica mattina alle 08:00
  const LAST_CHECK_KEY     = 'vv_report_last_check';
  const GENERATING_LOCK_KEY = 'vv_report_lock';   // lock cross-tab
  const LOCK_TIMEOUT_MS    = 90 * 1000;           // 90 s max lock duration
  const RECENT_NOTES_COUNT = 7;                   // note da analizzare in dettaglio
  const HISTORY_CAP        = 200;                 // max note storiche da passare al contesto

  // ── STATO INTERNO ─────────────────────────────────────────────────────────────
  let _sb       = null;
  let _groqKey  = '';
  let _userId   = null;
  let _timer    = null;
  let _initialized = false;
  let _generating  = false;

  // ── INIT ──────────────────────────────────────────────────────────────────────
  /**
   * @param {object} supabaseClient - istanza supabase già creata in index.html
   * @param {string} groqKey        - chiave Groq API
   */
  async function init(supabaseClient, groqKey, userId = null) {
    if (!supabaseClient) { console.warn('[ReportManager] init: manca supabaseClient'); return; }
    if (!groqKey) { console.warn('[ReportManager] init: manca groqKey — report disabilitato finché non salvi la chiave Groq'); }
    _sb      = supabaseClient;
    _groqKey = groqKey;
    _userId  = userId;
    _initialized = true;

    // Controlla subito al caricamento
    await _checkAndGenerate();

    // Poi controlla ogni ora
    _timer = setInterval(_checkAndGenerate, CHECK_INTERVAL);
  }

  // ── AGGIORNA CHIAVE GROQ (chiamare se l'utente la cambia a runtime) ──────────
  function setGroqKey(key) { _groqKey = key; }

  // ── LOGICA DI TRIGGER ─────────────────────────────────────────────────────────
  async function _checkAndGenerate() {
    if (!_sb || !_groqKey) {
      console.log('[ReportManager] _checkAndGenerate skip:', !_sb ? 'no supabase' : 'no groqKey');
      return;
    }

    const now = new Date();
    const isSunday = now.getDay() === 0;
    const isAfterTrigger = now.getHours() >= TRIGGER_HOUR;

    if (!isSunday || !isAfterTrigger) {
      console.log('[ReportManager] _checkAndGenerate: non è domenica >= 08:00 (day=' + now.getDay() + ', hour=' + now.getHours() + ')');
      return;
    }

    // Evita di generare più volte nella stessa domenica
    const lastCheck = localStorage.getItem(LAST_CHECK_KEY);
    const todayStr  = _toLocalDateStr(now);
    if (lastCheck === todayStr) {
      console.log('[ReportManager] _checkAndGenerate: già controllato oggi (' + todayStr + ')');
      return;
    }

    // Controlla se esiste già un report per questa settimana in Supabase
    const weekStart = _getWeekStart(now);
    const alreadyExists = await _reportExistsForWeek(weekStart);
    if (alreadyExists) {
      console.log('[ReportManager] _checkAndGenerate: report già esistente per questa settimana');
      localStorage.setItem(LAST_CHECK_KEY, todayStr);
      return;
    }

    // Genera
    console.log('[ReportManager] _checkAndGenerate: genero report...');
    const success = await generateReport();
    if (success) {
      localStorage.setItem(LAST_CHECK_KEY, todayStr);
    }
  }

  // ── GENERA REPORT ─────────────────────────────────────────────────────────────
  /**
   * Può essere chiamato manualmente (pulsante nell'UI) o automaticamente.
   * Recupera TUTTE le note storiche come contesto, e analizza in dettaglio
   * le ultime RECENT_NOTES_COUNT note.
   * @returns {{ ok: boolean, reason?: string }}
   */
  async function generateReport() {
    if (!_sb) return { ok: false, reason: 'Supabase non inizializzato' };
    if (_generating) return { ok: false, reason: 'Generazione già in corso' };

    // ── Lock cross-tab: impedisce doppia generazione da più finestre/dispositivi ──
    const lockTs = parseInt(localStorage.getItem(GENERATING_LOCK_KEY) || '0', 10);
    if (Date.now() - lockTs < LOCK_TIMEOUT_MS) {
      return { ok: false, reason: 'Generazione già in corso su un altro tab o dispositivo' };
    }

    _generating = true;
    localStorage.setItem(GENERATING_LOCK_KEY, String(Date.now()));
    try {
      // Leggi chiave Groq
      if (!_groqKey) _groqKey = (localStorage.getItem('vv_groq') || '').trim();
      if (!_groqKey) return { ok: false, reason: 'Chiave Groq mancante — salvala nelle impostazioni' };

      // 1. Controlla duplicato PRIMA della chiamata AI (fast check)
      const weekStart = _getWeekStart(new Date());
      if (await _reportExistsForWeek(weekStart)) {
        console.log('[ReportManager] generateReport: report già esistente');
        return { ok: false, reason: 'Esiste già un report per questa settimana' };
      }

      // 2. Recupera TUTTE le note storiche
      const allNotes = await _fetchAllNotes();
      if (!allNotes || allNotes.length === 0) {
        return { ok: false, reason: 'Nessuna nota trovata. Inizia a scrivere le tue prime note!' };
      }
      console.log('[ReportManager] generateReport: totale note storiche:', allNotes.length);

      // 3. Ultime RECENT_NOTES_COUNT = focus dell'analisi dettagliata
      const recentNotes     = allNotes.slice(-RECENT_NOTES_COUNT);
      const historicalNotes = allNotes.slice(0, Math.max(0, allNotes.length - RECENT_NOTES_COUNT));

      const recentText  = _buildNotesText(recentNotes);
      const historyText = historicalNotes.length > 0 ? _buildHistoryText(historicalNotes) : '';

      // 4a. Step 1: Estrai fatti strutturati
      let extractedFacts = null;
      try {
        extractedFacts = await _extractFacts(recentText);
        console.log('[ReportManager] Fatti estratti:', extractedFacts);
      } catch(e) {
        console.warn('[ReportManager] Estrazione fatti fallita, procedo senza:', e);
      }

      // 4b. Step 2: Genera report partendo dai fatti
      const { html: reportHtml, aiTitle } = await _callGroqReport(
        recentText, recentNotes, historyText, allNotes.length, extractedFacts
      );
      if (!reportHtml) {
        return { ok: false, reason: 'Groq ha restituito una risposta vuota' };
      }
      console.log('[ReportManager] generateReport: HTML ricevuto, lunghezza:', reportHtml.length);

      // 5. Controllo TOCTOU: altro dispositivo potrebbe aver salvato nel frattempo
      if (await _reportExistsForWeek(weekStart)) {
        console.log('[ReportManager] generateReport: report già salvato da un altro dispositivo, annullo');
        return { ok: false, reason: 'Un altro dispositivo ha già salvato il report' };
      }

      // 6. Salva
      const saved = await _saveReport(reportHtml, weekStart, aiTitle);
      console.log('[ReportManager] generateReport: salvato, id:', saved.id);
      return { ok: true };

    } catch(e) {
      console.warn('[ReportManager] generateReport error:', e);
      return { ok: false, reason: 'Errore: ' + (e.message || String(e)) };
    } finally {
      _generating = false;
      localStorage.removeItem(GENERATING_LOCK_KEY);
    }
  }

  // ── FETCH TUTTE LE NOTE (contesto storico + recenti) ─────────────────────────
  async function _fetchAllNotes() {
    const notes    = [];
    const pageSize = 500;
    let   from     = 0;

    while (true) {
      let q = _sb
        .from('notes')
        .select('id, title, content, note_date, mode')
        .not('mode', 'eq', REPORT_MODE)
        .order('note_date', { ascending: true })
        .range(from, from + pageSize - 1);
      if (_userId) q = q.eq('user_id', _userId);
      const { data, error } = await q;

      if (error) { console.warn('[ReportManager] _fetchAllNotes page error:', error); break; }
      if (!data || data.length === 0) break;
      notes.push(...data);
      if (data.length < pageSize) break;
      from += pageSize;
    }
    return notes;
  }

  // ── TESTO DETTAGLIATO (ultime N note — focus del report) ────────────────────
  function _buildNotesText(notes) {
    return notes.map(n => {
      const date    = n.note_date || '';
      const title   = n.title || 'Senza titolo';
      const mode    = _modeLabel(n.mode);
      const content = _stripHtml(n.content || '').slice(0, 800);
      return `[${date}] [${mode}] "${title}"\n${content}`;
    }).join('\n\n---\n\n');
  }

  // ── TESTO COMPRESSO PER CONTESTO STORICO ─────────────────────────────────────
  function _buildHistoryText(notes) {
    // Limita a HISTORY_CAP note per non eccedere la finestra di contesto del modello
    const capped = notes.slice(-HISTORY_CAP);

    // Raggruppa per mese per una panoramica leggibile
    const byMonth = {};
    capped.forEach(n => {
      const month = (n.note_date || '').slice(0, 7); // YYYY-MM
      if (!byMonth[month]) byMonth[month] = [];
      byMonth[month].push(n);
    });

    return Object.keys(byMonth).sort().map(month => {
      const ms    = byMonth[month];
      const d     = new Date(month + '-01T12:00:00');
      const label = d.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
      const entries = ms.map(n => {
        const title   = n.title || 'Senza titolo';
        const snippet = _stripHtml(n.content || '').slice(0, 130);
        return `  [${n.note_date}] "${title}": ${snippet}`;
      }).join('\n');
      return `[${label} — ${ms.length} note]\n${entries}`;
    }).join('\n\n');
  }

  function _modeLabel(mode) {
    return mode === 'rec' ? 'Registrazione vocale' :
           mode === 'AI'  ? 'Nota elaborata AI'    :
                            'Nota scritta';
  }

  // ── ESTRAZIONE FATTI STRUTTURATI (Step 1 della catena) ─────────────────────────
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

  // ── CHIAMATA GROQ ─────────────────────────────────────────────────────────────
  /**
   * @param {string} recentText   - testo dettagliato delle ultime N note (focus)
   * @param {Array}  recentNotes  - array oggetti delle ultime N note
   * @param {string} historyText  - contesto storico compresso (note precedenti)
   * @param {number} totalCount   - totale note nel diario
   * @param {object|null} extractedFacts - fatti strutturati estratti dallo step 1
   */
  async function _callGroqReport(recentText, recentNotes, historyText = '', totalCount = 0, extractedFacts = null) {
    // Estrai dati umore se presenti (dal Diario Guidato)
    const moodData = _extractMoodData(recentNotes);
    const moodContext = moodData.length > 0
      ? `\nUMORE REGISTRATO:\n${moodData.join('\n')}\n`
      : '';

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

    const n = recentNotes.length;

    const systemPrompt = `Sei il Digital Twin di VoceViva — un osservatore silenzioso con memoria a lungo termine che conosce l'utente attraverso TUTTE le sue note nel tempo.

Hai accesso a due livelli di informazione:
1. CONTESTO STORICO: panoramica compressa di tutte le note precedenti alle ultime ${n}
2. FOCUS: le ultime ${n} note in dettaglio — queste sono il cuore dell'analisi

Il tuo compito è restituire una lettura onesta della situazione attuale, confrontata con i pattern del passato. Non sei un coach, non sei un terapeuta. Sei uno specchio intelligente con memoria.

PRINCIPI:
- I FATTI ESTRATTI sopra hanno priorità sulla tua interpretazione diretta delle note
- Le dissonanze segnalate con ⚠ devono essere nominate nel report nella sezione "Quello che non torna"
- Se non ci sono dissonanze segnalate, scrivi esplicitamente "Nessuna incongruenza rilevante questa settimana"
- NON inventare dissonanze che non emergono dai fatti estratti
- Usa quasi sempre le sue parole, non le tue
- Non consolarlo né giudicarlo
- Le dissonanze vanno nominate con precisione, senza drammatizzarle
- I suggerimenti vengono SOLO dalle azioni che ha già scritto di voler fare
- Il tono è quello di un amico che ti conosce da anni e ti dice le cose come stanno
- Se la storia passata rivela pattern ricorrenti o cambiamenti rispetto al presente, nominali

STRUTTURA DEL REPORT (in HTML):
<report-title>Un titolo di massimo 6 parole che cattura l'essenza vera di questo momento, mai generico</report-title>
<h2>Analisi delle ultime ${n} note</h2>

<h3>📊 Com'è andata</h3>
[2-3 frasi che sintetizzano il periodo usando le sue parole chiave]

<h3>✓ Cosa ha funzionato</h3>
[Lista puntata — max 4 elementi — di cose concrete andate bene, usando frasi dall'utente]

<h3>⚡ Cosa non ha funzionato</h3>
[Lista puntata — max 3 elementi — di difficoltà o pattern negativi ricorrenti]

<h3>🔍 Quello che non torna</h3>
[0-2 dissonanze specifiche tra ciò che ha dichiarato e ciò che emerge dalle note. Se non ce ne sono: "Nessuna incongruenza rilevante." Non inventare dissonanze.]

<h3>🔁 Pattern nel tempo</h3>
[Solo se dalla storia emerge un pattern rilevante vs. il presente: nomina 1-2 ricorrenze o cambiamenti significativi. Se non ci sono pattern evidenti, ometti questa sezione completamente.]

<h3>→ Da qui</h3>
[2-3 azioni PICCOLE che l'utente stesso ha già scritto di voler fare. NON inventare. Se non ha scritto azioni concrete, suggerisci solo una domanda aperta.]

Scrivi in italiano. Tono diretto, niente enfasi vuota, niente punteggiatura decorativa.`;

    const historySection = historyText
      ? `## CONTESTO STORICO (${totalCount - n} note precedenti — usa per identificare pattern nel tempo):\n${historyText}\n\n---\n\n`
      : '';

    const userPrompt = `${historySection}${factsBlock}## FOCUS — ULTIME ${n} NOTE (testo completo per riferimento):
${moodContext}
${recentText}

Genera il report basandoti sui FATTI ESTRATTI sopra. Usa il testo delle note solo per citazioni dirette.`;

    try {
      const res = await fetch(GROQ_URL, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + _groqKey.trim(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: REPORT_MODEL,
          max_tokens: 2048,
          temperature: 0.4,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user',   content: userPrompt   }
          ]
        })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const msg = err?.error?.message || ('HTTP ' + res.status);
        console.warn('[ReportManager] Groq error:', msg, err);
        throw new Error('Groq: ' + msg);
      }

      const json = await res.json();
      const raw = json.choices?.[0]?.message?.content?.trim() || null;
      if (!raw) return { html: null, aiTitle: null };
      // Rimuovi eventuale wrapping markdown (```html ... ```)
      const clean = raw.replace(/^```html?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
      // Estrai il titolo generato dall'AI
      const titleMatch = clean.match(/<report-title>([\ \S]*?)<\/report-title>/i);
      const aiTitle = titleMatch ? titleMatch[1].trim() : null;
      const html = clean.replace(/<report-title>[\s\S]*?<\/report-title>\s*/i, '').trim();
      return { html, aiTitle };

    } catch(e) {
      console.warn('[ReportManager] _callGroqReport error:', e);
      throw e;  // propaga l'errore al chiamante
    }
  }

  // ── SALVA REPORT IN SUPABASE ──────────────────────────────────────────────────
  async function _saveReport(html, weekStart, aiTitle = null) {
    const weekStartStr = _toLocalDateStr(weekStart);
    const weekEnd      = _getWeekEnd(weekStart);
    const weekEndStr   = _toLocalDateStr(weekEnd);

    const dateRange = `${_formatDateIt(weekStart)} / ${_formatDateIt(weekEnd)}`;
    const title = aiTitle
      ? `${aiTitle} — ${dateRange}`
      : `Report Settimanale — ${dateRange}`;

    const noteData = {
      title,
      content: html,
      note_date: weekStartStr,
      mode: REPORT_MODE,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    if (_userId) noteData.user_id = _userId;

    const { data, error } = await _sb
      .from('notes')
      .insert([noteData])
      .select()
      .single();

    if (error) {
      console.warn('[ReportManager] save error:', error);
      throw new Error('Supabase: ' + (error.message || error.details || error.hint || JSON.stringify(error)));
    }

    // Notifica l'app che è disponibile un nuovo report
    window.dispatchEvent(new CustomEvent('vv:reportReady', { detail: data }));
    return data;
  }

  // ── CHECK REPORT ESISTENTE ────────────────────────────────────────────────────
  async function _reportExistsForWeek(weekStart) {
    const startStr = _toLocalDateStr(weekStart);
    const endStr   = _toLocalDateStr(_getWeekEnd(weekStart));

    let q = _sb
      .from('notes')
      .select('id')
      .eq('mode', REPORT_MODE)
      .gte('note_date', startStr)
      .lte('note_date', endStr)
      .limit(1);
    if (_userId) q = q.eq('user_id', _userId);
    const { data } = await q;

    return data && data.length > 0;
  }

  // ── FETCH ULTIMO REPORT ───────────────────────────────────────────────────────
  async function _fetchLatestReport() {
    let q = _sb
      .from('notes')
      .select('id, title, content, note_date, created_at')
      .eq('mode', REPORT_MODE)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    if (_userId) q = _sb
      .from('notes')
      .select('id, title, content, note_date, created_at')
      .eq('mode', REPORT_MODE)
      .eq('user_id', _userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    const { data, error } = await q;

    if (error) console.log('[ReportManager] _fetchLatestReport: nessun report trovato');
    return data || null;
  }

  // ── RENDER CARD IN ANNOTAZIONI ────────────────────────────────────────────────
  /**
   * Inserisce la card Report Settimanale nel container delle Annotazioni.
   * Va chiamata ogni volta che si renderizza la lista delle annotazioni.
   *
   * @param {HTMLElement} container - elemento DOM dove inserire la card
   *                                  (il container padre delle card annotazioni)
   * @param {HTMLElement} referenceNode - nodo di riferimento per l'inserimento
   *                                      (la card "In sospeso" se esiste, altrimenti null)
   */
  async function renderReportCard(container, referenceNode = null) {
    if (!_sb) { console.log('[ReportManager] renderReportCard: _sb non inizializzato'); return; }

    // Rimuovi card esistente se presente
    const existing = document.getElementById('vv-report-card');
    if (existing) existing.remove();

    const report = await _fetchLatestReport();
    if (!report) { console.log('[ReportManager] renderReportCard: nessun report da mostrare'); return; }

    // Mostra solo il report della settimana corrente o di quella appena passata
    const reportDate = new Date(report.note_date + 'T12:00:00');
    const now = new Date();
    const daysDiff = Math.floor((now - reportDate) / (1000 * 60 * 60 * 24));
    if (daysDiff > 13) return; // non mostrare report più vecchi di 2 settimane

    _ensureStyles();
    const card = _buildReportCard(report);

    // Inserisci SOPRA le card "In sospeso" ma SOTTO il pulsante +
    if (referenceNode && referenceNode.parentNode === container) {
      container.insertBefore(card, referenceNode);
    } else {
      // Fallback: inserisci come primo figlio del container
      container.insertBefore(card, container.firstChild);
    }
  }

  // ── INIETTA CSS UNA VOLTA ──────────────────────────────────────────────────────
  function _ensureStyles() {
    if (document.getElementById('vv-report-styles')) return;
    const style = document.createElement('style');
    style.id = 'vv-report-styles';
    style.textContent = `
      @keyframes vvModalIn { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
      .vv-report-card { background:var(--surface); border:1px solid var(--border); border-left:3px solid #38bdf8; border-radius:.8rem; padding:.94rem 1.13rem; display:flex; flex-direction:column; gap:.5rem; cursor:pointer; transition:background .15s,border-color .2s; margin-bottom:.5rem; }
      .vv-report-card:hover { background:rgba(56,189,248,.04); border-color:rgba(56,189,248,.55); }
      .vv-report-card-top { display:flex; align-items:center; justify-content:space-between; }
      .vv-report-card-meta { display:flex; align-items:center; gap:.5rem; }
      .vv-report-card-label { font-size:.65rem; text-transform:uppercase; letter-spacing:.13em; color:#38bdf8; }
      .vv-report-card-date { font-size:.69rem; color:var(--muted); font-family:'JetBrains Mono',monospace; }
      .vv-report-card-dismiss { background:none; border:none; color:var(--muted); font-size:.88rem; cursor:pointer; padding:.15rem .3rem; border-radius:.25rem; transition:color .12s; line-height:1; }
      .vv-report-card-dismiss:hover { color:#38bdf8; }
      .vv-report-card-title { font-family:'Crimson Pro',Georgia,serif; font-size:1.19rem; color:var(--text); line-height:1.3; }
      .vv-report-card-preview { font-size:.72rem; color:var(--muted); line-height:1.6; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
      .vv-report-body h2 { font-family:'DM Serif Display',serif; font-size:1.3rem; color:#fff; margin:.8rem 0 .4rem; line-height:1.3; }
      .vv-report-body h3 { font-family:'Crimson Pro',Georgia,serif; font-size:1.05rem; font-weight:500; color:#ddd; margin:.9rem 0 .3rem; }
      .vv-report-body p  { font-size:.95rem; line-height:1.85; color:#e8e8f0; margin-bottom:.5rem; font-family:'Crimson Pro',Georgia,serif; }
      .vv-report-body ul { padding-left:1.2rem; margin-bottom:.6rem; }
      .vv-report-body li { font-size:.9rem; line-height:1.8; color:#e8e8f0; font-family:'Crimson Pro',Georgia,serif; margin-bottom:.2rem; }
      .vv-report-body strong { color:#fff; }
    `;
    document.head.appendChild(style);
  }

  // ── COSTRUISCE LA CARD HTML ───────────────────────────────────────────────────
  function _buildReportCard(report) {
    const card = document.createElement('div');
    card.id = 'vv-report-card';
    card.className = 'vv-report-card';

    const dateStr = _formatDateIt(new Date(report.note_date + 'T12:00:00'));
    const plainText = _stripHtml(report.content || '');
    const previewText = plainText.slice(0, 120) + (plainText.length > 120 ? '…' : '');

    card.innerHTML =
      '<div class="vv-report-card-top">' +
        '<div class="vv-report-card-meta">' +
          '<span class="vv-report-card-label">Report Settimanale</span>' +
          '<span class="vv-report-card-date">' + dateStr + '</span>' +
        '</div>' +
        '<button class="vv-report-card-dismiss" title="Elimina report">✕</button>' +
      '</div>' +
      '<div class="vv-report-card-title">' + (report.title || 'Report Settimanale') + '</div>' +
      '<div class="vv-report-card-preview">' + previewText + '</div>';

    // Click sul corpo — apre modal
    card.addEventListener('click', (e) => {
      if (e.target.classList.contains('vv-report-card-dismiss') || e.target.closest('.vv-report-card-dismiss')) return;
      _openReportModal(report);
    });

    // Click su ✕ — elimina report
    card.querySelector('.vv-report-card-dismiss').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('Eliminare questo report settimanale?')) return;
      try {
        await _deleteReport(report.note_date);
        card.remove();
      } catch(err) {
        alert('Errore durante l\'eliminazione: ' + (err.message || err));
      }
    });

    return card;
  }

  // ── ELIMINA REPORT DA SUPABASE ────────────────────────────────────────────────
  // Elimina TUTTI i report della settimana (gestisce eventuali duplicati)
  async function _deleteReport(noteDate) {
    const weekStart = _getWeekStart(new Date(noteDate + 'T12:00:00'));
    const startStr  = _toLocalDateStr(weekStart);
    const endStr    = _toLocalDateStr(_getWeekEnd(weekStart));
    let q = _sb.from('notes').delete()
      .eq('mode', REPORT_MODE)
      .gte('note_date', startStr)
      .lte('note_date', endStr);
    if (_userId) q = q.eq('user_id', _userId);
    const { error } = await q;
    if (error) throw new Error('Supabase: ' + (error.message || JSON.stringify(error)));
    // Resetta il localStorage così può essere rigenerato
    localStorage.removeItem(LAST_CHECK_KEY);
  }

  // ── MODAL LETTURA REPORT ──────────────────────────────────────────────────────
  function _openReportModal(report) {
    // Rimuovi modal esistente
    const existing = document.getElementById('vv-report-modal');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'vv-report-modal';
    overlay.style.cssText = `
      display: flex;
      position: fixed;
      inset: 0;
      z-index: 200;
      background: rgba(0,0,0,.8);
      backdrop-filter: blur(6px);
      align-items: flex-end;
      justify-content: center;
      padding: 0;
      animation: vvModalIn .2s ease-out;
    `;

    // Inietta stili se non ancora presenti
    _ensureStyles();

    const sheet = document.createElement('div');
    sheet.style.cssText = `
      background: var(--surface, #111118);
      border: 1px solid rgba(56,189,248,.25);
      border-radius: 1.2rem 1.2rem 0 0;
      padding: 1.5rem 1.2rem 2.5rem;
      width: 100%;
      max-width: 640px;
      max-height: 88vh;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: .8rem;
    `;

    // Handle
    const handle = document.createElement('div');
    handle.style.cssText = 'width:36px;height:3px;background:var(--border,#1e1e2e);border-radius:2px;margin:0 auto .5rem;';

    // Header modal
    const modalHeader = document.createElement('div');
    modalHeader.style.cssText = 'display:flex;align-items:center;justify-content:space-between;';

    const badgeWrap = document.createElement('div');
    badgeWrap.style.cssText = 'display:flex;align-items:center;gap:.5rem;';

    const badge = document.createElement('span');
    badge.textContent = 'Report Settimanale';
    badge.style.cssText = `background:rgba(56,189,248,.12);border:1px solid rgba(56,189,248,.3);color:#38bdf8;font-family:'JetBrains Mono',monospace;font-size:.55rem;text-transform:uppercase;letter-spacing:.12em;padding:.1rem .5rem;border-radius:.3rem;`;

    const dateEl = document.createElement('span');
    dateEl.style.cssText = 'font-size:.6rem;color:var(--muted,#5a5a7a);font-family:"JetBrains Mono",monospace;';
    dateEl.textContent = _formatDateIt(new Date(report.note_date + 'T12:00:00'));

    badgeWrap.appendChild(badge);
    badgeWrap.appendChild(dateEl);

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = `background:none;border:none;color:var(--muted,#5a5a7a);font-size:1rem;cursor:pointer;padding:.2rem .4rem;`;
    closeBtn.onclick = () => overlay.remove();

    modalHeader.appendChild(badgeWrap);
    modalHeader.appendChild(closeBtn);

    // Contenuto report
    const body = document.createElement('div');
    body.className = 'vv-report-body';
    body.innerHTML = report.content || '';

    sheet.appendChild(handle);
    sheet.appendChild(modalHeader);
    sheet.appendChild(body);
    overlay.appendChild(sheet);
    document.body.appendChild(overlay);

    // Chiudi toccando fuori
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
  }

  // ── ESTRAE DATI UMORE DAL DIARIO GUIDATO ─────────────────────────────────────
  function _extractMoodData(notes) {
    const moods = [];
    notes.forEach(n => {
      if (!n.content) return;
      // Cerca il pattern "Umore: emoji Label (N/5)"
      const match = n.content.match(/Umore[:\s]+([^<(]+)\((\d)\/5\)/i);
      if (match) {
        moods.push(`${n.note_date}: ${match[1].trim()} (${match[2]}/5)`);
      }
    });
    return moods;
  }

  // ── HELPER DATE ───────────────────────────────────────────────────────────────

  /** Restituisce il lunedì della settimana della data fornita */
  function _getWeekStart(date) {
    const d = new Date(date);
    const day = d.getDay(); // 0=domenica
    const diff = day === 0 ? -6 : 1 - day; // vai al lunedì
    d.setDate(d.getDate() + diff);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  /** Restituisce la domenica della settimana della data fornita */
  function _getWeekEnd(date) {
    const start = _getWeekStart(date);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    return end;
  }

  function _formatDateIt(date) {
    return date.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  /** Converte una Date in stringa YYYY-MM-DD locale (evita shift UTC) */
  function _toLocalDateStr(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  // ── HELPER HTML ───────────────────────────────────────────────────────────────
  function _stripHtml(html) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    return (tmp.textContent || tmp.innerText || '').replace(/\s+/g, ' ').trim();
  }

  // ── API PUBBLICA ──────────────────────────────────────────────────────────────
  return {
    init,
    setGroqKey,
    generateReport,   // chiamabile manualmente da un pulsante UI
    renderReportCard  // chiamare ogni volta che si renderizza la lista annotazioni
  };

})();
