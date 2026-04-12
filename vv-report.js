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
  const REPORT_MODEL   = 'llama-3.3-70b-versatile';
  const REPORT_MODE    = 'report';
  const CHECK_INTERVAL = 60 * 60 * 1000; // controlla ogni ora
  const TRIGGER_HOUR   = 8;              // domenica mattina alle 08:00
  const LAST_CHECK_KEY = 'vv_report_last_check';

  // ── STATO INTERNO ─────────────────────────────────────────────────────────────
  let _sb       = null;
  let _groqKey  = '';
  let _timer    = null;
  let _initialized = false;

  // ── INIT ──────────────────────────────────────────────────────────────────────
  /**
   * @param {object} supabaseClient - istanza supabase già creata in index.html
   * @param {string} groqKey        - chiave Groq API
   */
  async function init(supabaseClient, groqKey) {
    if (!supabaseClient || !groqKey) return;
    _sb      = supabaseClient;
    _groqKey = groqKey;
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
    if (!_sb || !_groqKey) return;

    const now = new Date();
    const isSunday = now.getDay() === 0;
    const isAfterTrigger = now.getHours() >= TRIGGER_HOUR;

    if (!isSunday || !isAfterTrigger) return;

    // Evita di generare più volte nella stessa domenica
    const lastCheck = localStorage.getItem(LAST_CHECK_KEY);
    const todayStr  = now.toISOString().split('T')[0];
    if (lastCheck === todayStr) return;

    // Controlla se esiste già un report per questa settimana in Supabase
    const weekStart = _getWeekStart(now);
    const alreadyExists = await _reportExistsForWeek(weekStart);
    if (alreadyExists) {
      localStorage.setItem(LAST_CHECK_KEY, todayStr);
      return;
    }

    // Genera
    const success = await generateReport();
    if (success) {
      localStorage.setItem(LAST_CHECK_KEY, todayStr);
    }
  }

  // ── GENERA REPORT ─────────────────────────────────────────────────────────────
  /**
   * Può essere chiamato manualmente (pulsante nell'UI) o automaticamente.
   * @returns {boolean} true se il report è stato generato e salvato
   */
  async function generateReport() {
    if (!_sb || !_groqKey) return false;

    try {
      // 1. Recupera note della settimana
      const notes = await _fetchWeekNotes();
      if (!notes || notes.length === 0) return false;

      // 2. Prepara testo per il prompt
      const notesText = _buildNotesText(notes);

      // 3. Chiama Groq per il report
      const reportHtml = await _callGroqReport(notesText, notes);
      if (!reportHtml) return false;

      // 4. Salva in Supabase
      const weekStart = _getWeekStart(new Date());
      const saved = await _saveReport(reportHtml, weekStart);
      return !!saved;

    } catch(e) {
      console.warn('[ReportManager] generateReport error:', e);
      return false;
    }
  }

  // ── FETCH NOTE SETTIMANA ──────────────────────────────────────────────────────
  async function _fetchWeekNotes() {
    const now   = new Date();
    const start = _getWeekStart(now);
    const end   = _getWeekEnd(now);

    const startStr = start.toISOString().split('T')[0];
    const endStr   = end.toISOString().split('T')[0];

    const { data, error } = await _sb
      .from('notes')
      .select('id, title, content, note_date, mode')
      .gte('note_date', startStr)
      .lte('note_date', endStr)
      .in('mode', ['write', 'ai', 'rec'])  // esclude i report stessi
      .order('note_date', { ascending: true });

    if (error) {
      console.warn('[ReportManager] fetch error:', error);
      return [];
    }
    return data || [];
  }

  // ── COSTRUISCE IL TESTO DA PASSARE A GROQ ────────────────────────────────────
  function _buildNotesText(notes) {
    return notes.map(n => {
      const date    = n.note_date || '';
      const title   = n.title || 'Senza titolo';
      const mode    = _modeLabel(n.mode);
      const content = _stripHtml(n.content || '').slice(0, 800);
      return `[${date}] [${mode}] "${title}"\n${content}`;
    }).join('\n\n---\n\n');
  }

  function _modeLabel(mode) {
    return mode === 'rec' ? 'Registrazione vocale' :
           mode === 'ai'  ? 'Nota elaborata AI'    :
                            'Nota scritta';
  }

  // ── CHIAMATA GROQ ─────────────────────────────────────────────────────────────
  async function _callGroqReport(notesText, notes) {
    // Estrai dati umore se presenti (dal Diario Guidato)
    const moodData = _extractMoodData(notes);
    const moodContext = moodData.length > 0
      ? `\nUMORE REGISTRATO QUESTA SETTIMANA:\n${moodData.join('\n')}\n`
      : '';

    const systemPrompt = `Sei il Digital Twin di VoceViva — un osservatore silenzioso che conosce l'utente attraverso le sue note. Hai letto tutto quello che ha scritto questa settimana.

Il tuo compito è restituire all'utente una lettura onesta e precisa della sua settimana. Non sei un coach, non sei un terapeuta. Sei uno specchio intelligente.

PRINCIPI:
- Usa quasi sempre le sue parole, non le tue
- Non consolarlo né giudicarlo
- Le dissonanze vanno nominate con precisione, senza drammatizzarle
- I suggerimenti vengono SOLO dalle azioni che ha già scritto di voler fare
- Il tono è quello di un amico che ti conosce da anni e ti dice le cose come stanno

STRUTTURA DEL REPORT (in HTML):
<h2>Settimana dal [data inizio] al [data fine]</h2>

<h3>📊 Com'è andata</h3>
[2-3 frasi che sintetizzano la settimana usando le sue parole chiave]

<h3>✓ Cosa ha funzionato</h3>
[Lista puntata — max 4 elementi — di cose concrete andate bene, usando frasi dall'utente]

<h3>⚡ Cosa non ha funzionato</h3>
[Lista puntata — max 3 elementi — di difficoltà o pattern negativi ricorrenti]

<h3>🔍 Quello che non torna</h3>
[0-2 dissonanze specifiche tra ciò che ha dichiarato e ciò che emerge dalle note. Se non ce ne sono scrivere: "Nessuna incongruenza rilevante questa settimana." Non inventare dissonanze.]

<h3>→ Da qui</h3>
[2-3 azioni PICCOLE che l'utente stesso ha già scritto di voler fare. NON inventare. Se non ha scritto azioni concrete, suggerisci solo una domanda aperta.]

Scrivi in italiano. Tono diretto, niente enfasi vuota, niente punteggiatura decorativa.`;

    const userPrompt = `Queste sono tutte le note scritte questa settimana:
${moodContext}
NOTE:
${notesText}

Genera il report settimanale seguendo esattamente la struttura indicata.`;

    try {
      const res = await fetch(GROQ_URL, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + _groqKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: REPORT_MODEL,
          max_tokens: 1000,
          temperature: 0.4,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user',   content: userPrompt   }
          ]
        })
      });

      if (!res.ok) {
        const err = await res.json();
        console.warn('[ReportManager] Groq error:', err);
        return null;
      }

      const json = await res.json();
      return json.choices?.[0]?.message?.content?.trim() || null;

    } catch(e) {
      console.warn('[ReportManager] _callGroqReport error:', e);
      return null;
    }
  }

  // ── SALVA REPORT IN SUPABASE ──────────────────────────────────────────────────
  async function _saveReport(html, weekStart) {
    const weekStartStr = weekStart.toISOString().split('T')[0];
    const weekEnd      = _getWeekEnd(weekStart);
    const weekEndStr   = weekEnd.toISOString().split('T')[0];

    const title = `Report Settimanale — ${_formatDateIt(weekStart)} / ${_formatDateIt(weekEnd)}`;

    const { data, error } = await _sb
      .from('notes')
      .insert([{
        title,
        content: html,
        note_date: weekStartStr,
        mode: REPORT_MODE
      }])
      .select()
      .single();

    if (error) {
      console.warn('[ReportManager] save error:', error);
      return null;
    }

    // Notifica l'app che è disponibile un nuovo report
    window.dispatchEvent(new CustomEvent('vv:reportReady', { detail: data }));
    return data;
  }

  // ── CHECK REPORT ESISTENTE ────────────────────────────────────────────────────
  async function _reportExistsForWeek(weekStart) {
    const startStr = weekStart.toISOString().split('T')[0];
    const endStr   = _getWeekEnd(weekStart).toISOString().split('T')[0];

    const { data } = await _sb
      .from('notes')
      .select('id')
      .eq('mode', REPORT_MODE)
      .gte('note_date', startStr)
      .lte('note_date', endStr)
      .limit(1);

    return data && data.length > 0;
  }

  // ── FETCH ULTIMO REPORT ───────────────────────────────────────────────────────
  async function _fetchLatestReport() {
    const { data } = await _sb
      .from('notes')
      .select('id, title, content, note_date, created_at')
      .eq('mode', REPORT_MODE)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

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
    if (!_sb) return;

    // Rimuovi card esistente se presente
    const existing = document.getElementById('vv-report-card');
    if (existing) existing.remove();

    const report = await _fetchLatestReport();
    if (!report) return;

    // Mostra solo il report della settimana corrente o di quella appena passata
    const reportDate = new Date(report.note_date + 'T12:00:00');
    const now = new Date();
    const daysDiff = Math.floor((now - reportDate) / (1000 * 60 * 60 * 24));
    if (daysDiff > 13) return; // non mostrare report più vecchi di 2 settimane

    const card = _buildReportCard(report);

    // Inserisci SOPRA le card "In sospeso" ma SOTTO il pulsante +
    if (referenceNode && referenceNode.parentNode === container) {
      container.insertBefore(card, referenceNode);
    } else {
      // Fallback: inserisci come primo figlio del container
      container.insertBefore(card, container.firstChild);
    }
  }

  // ── COSTRUISCE LA CARD HTML ───────────────────────────────────────────────────
  function _buildReportCard(report) {
    const card = document.createElement('div');
    card.id = 'vv-report-card';
    card.className = 'vv-report-card';
    card.style.cssText = `
      background: var(--surface, #111118);
      border: 1px solid rgba(56,189,248,.3);
      border-radius: 1rem;
      padding: 1.1rem;
      display: flex;
      flex-direction: column;
      gap: .7rem;
      margin-bottom: .5rem;
      cursor: pointer;
      transition: border-color .2s;
    `;

    // Header
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:.5rem;';

    const leftGroup = document.createElement('div');
    leftGroup.style.cssText = 'display:flex;align-items:center;gap:.5rem;';

    // Etichetta azzurra
    const badge = document.createElement('span');
    badge.textContent = 'Report Settimanale';
    badge.style.cssText = `
      background: rgba(56,189,248,.12);
      border: 1px solid rgba(56,189,248,.3);
      color: #38bdf8;
      font-family: 'JetBrains Mono', monospace;
      font-size: .55rem;
      text-transform: uppercase;
      letter-spacing: .12em;
      padding: .1rem .5rem;
      border-radius: .3rem;
    `;

    const dateLabel = document.createElement('span');
    dateLabel.style.cssText = 'font-size:.58rem;color:var(--muted,#5a5a7a);font-family:"JetBrains Mono",monospace;letter-spacing:.05em;';
    dateLabel.textContent = _formatDateIt(new Date(report.note_date + 'T12:00:00'));

    leftGroup.appendChild(badge);
    leftGroup.appendChild(dateLabel);

    // Chevron
    const chevron = document.createElement('span');
    chevron.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;color:var(--muted,#5a5a7a)"><polyline points="9 18 15 12 9 6"/></svg>`;

    header.appendChild(leftGroup);
    header.appendChild(chevron);

    // Titolo
    const titleEl = document.createElement('div');
    titleEl.style.cssText = `
      font-family: 'Crimson Pro', Georgia, serif;
      font-size: 1rem;
      color: var(--text, #e8e8f0);
      line-height: 1.4;
    `;
    titleEl.textContent = report.title || 'Report Settimanale';

    // Preview — prima frase del contenuto
    const preview = document.createElement('div');
    preview.style.cssText = `
      font-size: .72rem;
      color: var(--muted, #5a5a7a);
      line-height: 1.6;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    `;
    const plainText = _stripHtml(report.content || '');
    preview.textContent = plainText.slice(0, 120) + (plainText.length > 120 ? '…' : '');

    card.appendChild(header);
    card.appendChild(titleEl);
    card.appendChild(preview);

    // Hover
    card.addEventListener('mouseenter', () => {
      card.style.borderColor = 'rgba(56,189,248,.6)';
    });
    card.addEventListener('mouseleave', () => {
      card.style.borderColor = 'rgba(56,189,248,.3)';
    });

    // Click — apre modal con contenuto completo
    card.addEventListener('click', () => _openReportModal(report));

    return card;
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

    // Aggiungi keyframe se non esiste
    if (!document.getElementById('vv-report-styles')) {
      const style = document.createElement('style');
      style.id = 'vv-report-styles';
      style.textContent = `
        @keyframes vvModalIn { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
        .vv-report-body h2 { font-family:'DM Serif Display',serif; font-size:1.3rem; color:#fff; margin:.8rem 0 .4rem; line-height:1.3; }
        .vv-report-body h3 { font-family:'Crimson Pro',Georgia,serif; font-size:1.05rem; font-weight:500; color:#ddd; margin:.9rem 0 .3rem; }
        .vv-report-body p  { font-size:.95rem; line-height:1.85; color:#e8e8f0; margin-bottom:.5rem; font-family:'Crimson Pro',Georgia,serif; }
        .vv-report-body ul { padding-left:1.2rem; margin-bottom:.6rem; }
        .vv-report-body li { font-size:.9rem; line-height:1.8; color:#e8e8f0; font-family:'Crimson Pro',Georgia,serif; margin-bottom:.2rem; }
        .vv-report-body strong { color:#fff; }
      `;
      document.head.appendChild(style);
    }

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
