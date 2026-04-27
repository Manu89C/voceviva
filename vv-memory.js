/**
 * vv-memory.js — VoceViva Memory Manager v1
 * ─────────────────────────────────────────────────────────────────────────────
 * Aggiunge memoria semantica a lungo termine all'app.
 * 
 * COSA FA:
 *   1. Vettorializza le note (nuove e storiche) via Cohere Embed API
 *   2. Salva i vettori su Supabase (pgvector) nella colonna `embedding`
 *   3. Recupera le note semanticamente simili a un testo dato (RAG retrieval)
 *   4. Alimenta il Dissonance Engine: trova incongruenze tra obiettivi e note recenti
 *   5. Mostra un banner "Indicizza memoria storica" la prima volta
 *
 * PREREQUISITI SUPABASE:
 *   Esegui queste query nell'SQL editor di Supabase UNA VOLTA SOLA:
 *
 *   -- 1. Abilita pgvector
 *   create extension if not exists vector;
 *
 *   -- 2. Aggiungi colonna embedding alla tabella notes
 *   alter table notes add column if not exists embedding vector(1024);
 *
 *   -- 3. Crea indice per ricerca veloce
 *   create index if not exists notes_embedding_idx
 *     on notes using ivfflat (embedding vector_cosine_ops)
 *     with (lists = 100);
 *
 *   -- 4. Crea funzione di ricerca semantica
 *   create or replace function match_notes(
 *     query_embedding vector(1024),
 *     match_count int default 5,
 *     similarity_threshold float default 0.3
 *   )
 *   returns table (
 *     id bigint,
 *     title text,
 *     content text,
 *     note_date date,
 *     similarity float
 *   )
 *   language sql stable
 *   as $$
 *     select
 *       id, title, content, note_date,
 *       1 - (embedding <=> query_embedding) as similarity
 *     from notes
 *     where embedding is not null
 *       and 1 - (embedding <=> query_embedding) > similarity_threshold
 *     order by embedding <=> query_embedding
 *     limit match_count;
 *   $$;
 *
 * INTEGRAZIONE IN index.html:
 *   1. Aggiungi dopo <script src="vv-profile.js">:
 *      <script src="vv-memory.js"></script>
 *
 *   2. Aggiungi dopo MemoryManager.init() (vedi sotto) nel tuo JS di inizializzazione.
 *
 *   3. Quando salvi una nota (modalConfirm.onclick), aggiungi DOPO il sb.from('notes').insert:
 *      if (data && data[0]) await MemoryManager.indexNote(data[0]);
 *      NOTA: modifica l'insert per restituire i dati: .insert([_rec]).select()
 *
 *   4. Per ottenere contesto RAG prima di chiamare callLlama():
 *      const memCtx = await MemoryManager.getContext(getEditorText());
 *      // passa memCtx al system prompt di callLlama
 */

const MemoryManager = (() => {

  // ── COSTANTI ────────────────────────────────────────────────────────────────
  const SUPABASE_URL   = 'https://ezycobgovadcgvnyqcew.supabase.co';
  const SUPABASE_KEY   = 'sb_publishable_ASHxxToKJyMy4CpBAqseqA_mepXAAJ-';
  const COHERE_EMBED_URL = 'https://api.cohere.com/v2/embed';
  const EMBED_MODEL    = 'embed-multilingual-v3.0'; // supporta italiano
  const EMBED_DIMS     = 1024;
  const STORAGE_KEY_COHERE = 'vv_cohere';
  const STORAGE_KEY_INDEXED = 'vv_memory_indexed'; // flag: indicizzazione già fatta
  const TABLE_PROFILE = 'vv_user_profile';
  const BATCH_SIZE     = 20; // note per batch (limite Cohere free: 96/min)
  const BATCH_DELAY_MS = 1200; // pausa tra batch per rispettare rate limit

  let _sb = null;
  let _cohereKey = '';
  let _initialized = false;
  let _userId = null;

  // ── INIT ────────────────────────────────────────────────────────────────────
  async function init(userId = null) {
    _userId = userId;
    try {
      _sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    } catch(e) {
      console.warn('[MemoryManager] Supabase non disponibile:', e);
      return;
    }
    _cohereKey = localStorage.getItem(STORAGE_KEY_COHERE) || '';
    _initialized = true;

    // Mostra banner se: chiave presente, mai indicizzato prima
    if (_cohereKey) {
      const indexed = await _isIndexedOnServer();
      if (!indexed) _showIndexBanner();
  }
    // Inietta UI per la chiave Cohere nell'api-card esistente
    _injectCohereKeyUI();
  }

  // ── UI: CHIAVE COHERE ────────────────────────────────────────────────────────
  function _injectCohereKeyUI() {
    const apiCard = document.getElementById('apiCard');
    if (!apiCard || document.getElementById('cohereKeyRow')) return;

    const row = document.createElement('div');
    row.id = 'cohereKeyRow';
    row.style.cssText = 'display:flex;gap:.5rem;margin-top:.5rem;';
    row.innerHTML = `
      <input class="api-input" type="password" id="cohereKeyInput"
        placeholder="Chiave Cohere (memoria semantica)"
        autocomplete="off" spellcheck="false"
        style="flex:1">
      <button class="btn-save" id="saveCohereBtn">Salva</button>
    `;
    const hint = document.createElement('p');
    hint.className = 'api-hint';
    hint.innerHTML = 'Gratis su <a href="https://dashboard.cohere.com/api-keys" target="_blank">dashboard.cohere.com</a> · necessaria per la memoria a lungo termine';

    apiCard.appendChild(row);
    apiCard.appendChild(hint);

    const input = document.getElementById('cohereKeyInput');
    const btn   = document.getElementById('saveCohereBtn');

    if (_cohereKey) input.value = _cohereKey;

    btn.onclick = () => {
      const k = input.value.trim();
      if (!k) return;
      _cohereKey = k;
      localStorage.setItem(STORAGE_KEY_COHERE, k);
      btn.textContent = '✓';
      btn.style.background = '#4ade80';
      btn.style.color = '#0a0a0f';
      setTimeout(() => { btn.textContent = 'Salva'; btn.style = ''; }, 2000);
      // Mostra banner se non ancora indicizzato
      if (!localStorage.getItem(STORAGE_KEY_INDEXED)) _showIndexBanner();
    };
  }

  // ── UI: BANNER INDICIZZAZIONE ────────────────────────────────────────────────
  function _showIndexBanner() {
    if (document.getElementById('memoryBanner')) return;

    const banner = document.createElement('div');
    banner.id = 'memoryBanner';
    banner.style.cssText = `
      background: rgba(245,80,54,.07);
      border: 1px solid rgba(245,80,54,.25);
      border-radius: .8rem;
      padding: .9rem 1rem;
      display: flex;
      flex-direction: column;
      gap: .6rem;
      font-family: 'JetBrains Mono', monospace;
    `;
    banner.innerHTML = `
      <div style="display:flex;align-items:center;gap:.5rem;">
        <span style="width:6px;height:6px;border-radius:50%;background:#f55036;flex-shrink:0;"></span>
        <span style="font-size:.6rem;text-transform:uppercase;letter-spacing:.12em;color:#f55036;">Memoria a lungo termine</span>
      </div>
      <p style="font-size:.78rem;line-height:1.7;color:#e8e8f0;">
        Indicizza le tue note esistenti per attivare il <strong>Dissonance Engine</strong> — 
        l'AI potrà collegare il presente al tuo passato e rilevare pattern nel tempo.
      </p>
      <div style="display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;">
        <button id="startIndexBtn" class="btn-save" style="flex:1;min-width:120px;">
          Indicizza memoria storica
        </button>
        <button id="dismissBannerBtn" style="background:none;border:1px solid #1e1e2e;color:#5a5a7a;padding:.55rem .9rem;border-radius:.6rem;font-family:'JetBrains Mono',monospace;font-size:.68rem;cursor:pointer;white-space:nowrap;">
          Dopo
        </button>
      </div>
      <div id="indexProgress" style="display:none;flex-direction:column;gap:.4rem;">
        <div style="height:3px;background:#1e1e2e;border-radius:2px;overflow:hidden;">
          <div id="indexProgressFill" style="height:100%;width:0%;background:#f55036;border-radius:2px;transition:width .3s;"></div>
        </div>
        <span id="indexProgressText" style="font-size:.6rem;color:#5a5a7a;letter-spacing:.08em;"></span>
      </div>
    `;

    // Inserisci dopo l'api-card
    const apiCard = document.getElementById('apiCard');
    if (apiCard && apiCard.nextSibling) {
      apiCard.parentNode.insertBefore(banner, apiCard.nextSibling);
    } else {
      document.querySelector('.container')?.appendChild(banner);
    }

    document.getElementById('startIndexBtn').onclick = () => _runIndexing(banner);
    document.getElementById('dismissBannerBtn').onclick = () => banner.remove();
  }

  // ── INDICIZZAZIONE STORICA ──────────────────────────────────────────────────
  async function _runIndexing(banner) {
    if (!_sb || !_cohereKey) {
      alert('Inserisci prima la chiave Cohere.');
      return;
    }

    const startBtn = document.getElementById('startIndexBtn');
    const dismissBtn = document.getElementById('dismissBannerBtn');
    const progressSection = document.getElementById('indexProgress');
    const progressFill = document.getElementById('indexProgressFill');
    const progressText = document.getElementById('indexProgressText');

    startBtn.disabled = true;
    startBtn.textContent = 'Carico note...';
    dismissBtn.style.display = 'none';
    progressSection.style.display = 'flex';

    try {
      // Recupera tutte le note senza embedding
      const { data: notes, error } = await _sb
        .from('notes')
        .select('id, title, content, note_date')
        .is('embedding', null)
        .order('note_date', { ascending: true });

      if (error) throw error;

      if (!notes || notes.length === 0) {
        progressText.textContent = 'Tutte le note sono già indicizzate.';
        progressFill.style.width = '100%';
        await _setIndexedOnServer();
        setTimeout(() => banner.remove(), 2500);
        return;
      }

      const total = notes.length;
      let processed = 0;

      // Processa in batch
      for (let i = 0; i < notes.length; i += BATCH_SIZE) {
        const batch = notes.slice(i, i + BATCH_SIZE);
        const texts = batch.map(n => _noteToText(n));

        progressText.textContent = `Indicizzando ${processed + 1}–${Math.min(processed + batch.length, total)} di ${total} note…`;

        const embeddings = await _embedTexts(texts);

        // Aggiorna ogni nota con il suo vettore
        for (let j = 0; j < batch.length; j++) {
          if (!embeddings[j]) continue;
          await _sb
            .from('notes')
            .update({ embedding: embeddings[j] })
            .eq('id', batch[j].id);
          processed++;
          progressFill.style.width = Math.round((processed / total) * 100) + '%';
        }

        // Pausa tra batch per rispettare rate limit Cohere free
        if (i + BATCH_SIZE < notes.length) {
          await _sleep(BATCH_DELAY_MS);
        }
      }

      // Completato
      await _setIndexedOnServer();
      progressText.textContent = `✓ ${total} note indicizzate. La memoria a lungo termine è attiva.`;
      progressFill.style.width = '100%';
      progressFill.style.background = '#4ade80';
      startBtn.style.display = 'none';

      setTimeout(() => banner.remove(), 3000);

    } catch(e) {
      console.error('[MemoryManager] Errore indicizzazione:', e);
      progressText.textContent = 'Errore: ' + (e.message || 'controlla la chiave Cohere e riprova.');
      startBtn.disabled = false;
      startBtn.textContent = 'Riprova';
    }
  }

  // ── INDICIZZA UNA NOTA SINGOLA (chiamare dopo ogni salvataggio) ──────────────
  async function indexNote(note) {
    if (!_sb || !_cohereKey || !note?.id) return;
    try {
      const text = _noteToText(note);
      const embeddings = await _embedTexts([text]);
      if (!embeddings[0]) return;
      await _sb
        .from('notes')
        .update({ embedding: embeddings[0] })
        .eq('id', note.id);
    } catch(e) {
      console.warn('[MemoryManager] indexNote error:', e);
    }
  }

  // ── RAG: RECUPERA CONTESTO SEMANTICO ────────────────────────────────────────
  /**
   * Dato un testo (la sessione corrente), recupera le note più simili dal passato.
   * Restituisce un blocco di testo pronto da iniettare nel system prompt.
   *
   * @param {string} currentText - Il testo della sessione corrente
   * @param {number} limit - Quante note recuperare (default 5)
   * @returns {string} - Blocco di contesto per il prompt
   */
  async function getContext(currentText, limit = 5) {
    if (!_sb || !_cohereKey || !currentText?.trim()) return '';
    try {
      const embeddings = await _embedTexts([currentText]);
      if (!embeddings[0]) return '';

      const { data, error } = await _sb.rpc('match_notes', {
        query_embedding: embeddings[0],
        match_count: limit,
        similarity_threshold: 0.3
      });

      if (error || !data?.length) return '';

      const lines = data.map(n => {
        const date = n.note_date || 'data sconosciuta';
        const title = n.title || 'senza titolo';
        const snippet = _stripHtml(n.content || '').slice(0, 300);
        return `[${date}] "${title}": ${snippet}`;
      });

      return `MEMORIA STORICA RILEVANTE (ultime sessioni simili):\n${lines.join('\n\n')}`;

    } catch(e) {
      console.warn('[MemoryManager] getContext error:', e);
      return '';
    }
  }

  // ── DISSONANCE ENGINE ────────────────────────────────────────────────────────
  /**
   * Cerca incongruenze tra un obiettivo dichiarato e le note recenti.
   * Restituisce un blocco testo da aggiungere al prompt dell'AI.
   *
   * @param {string} currentText - Sessione corrente
   * @param {string} groqKey - Chiave Groq per il reasoning finale
   * @returns {string} - Insight sulle incongruenze trovate (o stringa vuota)
   */
  async function getDissonance(currentText, groqKey) {
    if (!_sb || !_cohereKey || !currentText?.trim() || !groqKey) return '';
    try {
      // Recupera contesto ampio (10 note)
      const context = await getContext(currentText, 10);
      if (!context) return '';

      const prompt = `Sei il Dissonance Engine di VoceViva. Analizza la SESSIONE CORRENTE rispetto alla MEMORIA STORICA.

SESSIONE CORRENTE:
${currentText}

${context}

Identifica SOLO SE PRESENTE una incongruenza significativa tra:
- Valori o obiettivi dichiarati in passato
- Emozioni, azioni o pensieri espressi oggi

Se trovi un'incongruenza reale, rispondi con UNA sola osservazione, massimo 2 righe, in italiano, tono neutro e non giudicante.
Se non c'è nulla di rilevante, rispondi solo: NESSUNA_INCONGRUENZA`;

      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + groqKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'llama-3.1-8b-instant',
          max_tokens: 120,
          temperature: 0.3,
          messages: [{ role: 'user', content: prompt }]
        })
      });

      const json = await res.json();
      const result = json.choices?.[0]?.message?.content?.trim() || '';
      if (result === 'NESSUNA_INCONGRUENZA' || !result) return '';
      return result;

    } catch(e) {
      console.warn('[MemoryManager] getDissonance error:', e);
      return '';
    }
  }

  // ── RIEPILOGO PERIODICO ──────────────────────────────────────────────────────
  /**
   * Genera un riepilogo del percorso dell'utente basato sulle note recenti.
   * Usare per la feature "Il tuo mese" o come contesto per il Digital Twin.
   *
   * @param {string} groqKey
   * @param {number} days - Quanti giorni di storia considerare (default 30)
   * @returns {string} - Riepilogo in HTML
   */
  async function getSummary(groqKey, days = 30) {
    if (!_sb || !groqKey) return '';
    try {
      const since = new Date();
      since.setDate(since.getDate() - days);
      const sinceStr = since.toISOString().split('T')[0];

      const { data: notes, error } = await _sb
        .from('notes')
        .select('title, content, note_date')
        .gte('note_date', sinceStr)
        .order('note_date', { ascending: true });

      if (error || !notes?.length) return '';

      const noteTexts = notes.map(n =>
        `[${n.note_date}] ${n.title || ''}: ${_stripHtml(n.content || '').slice(0, 200)}`
      ).join('\n\n');

      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + groqKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          max_tokens: 600,
          temperature: 0.5,
          messages: [{
            role: 'user',
            content: `Sei il Digital Twin di VoceViva. Analizza queste note degli ultimi ${days} giorni e scrivi un riepilogo del percorso della persona.

NOTE:
${noteTexts}

Scrivi in italiano. Struttura:
1. Tema dominante del periodo (1 frase)
2. Cosa sta cercando (1-2 frasi)
3. Pattern ricorrente (positivo o da esplorare)
4. Una domanda aperta per la prossima sessione

Tono: come un amico intelligente che conosce la persona da tempo. Non consolatorio, preciso.`
          }]
        })
      });

      const json = await res.json();
      return json.choices?.[0]?.message?.content?.trim() || '';

    } catch(e) {
      console.warn('[MemoryManager] getSummary error:', e);
      return '';
    }
  }
  // ── FLAG INDICIZZAZIONE SU SERVER ───────────────────────────────────────────
  // Controlla e salva lo stato di indicizzazione su Supabase invece che su
  // localStorage, così il flag è condiviso tra tutti i dispositivi dell'utente.
  async function _isIndexedOnServer() {
    const uid = _userId || 'default';
    try {
      // Prima controlla il flag di profilo (fast path)
      const { data } = await _sb
        .from(TABLE_PROFILE)
        .select('memory_indexed_at')
        .eq('user_id', uid)
        .single();
      if (data?.memory_indexed_at) return true;

      // Flag assente (es. nuovo device o migrazione auth):
      // controlla se esistono davvero note senza embedding
      const { count } = await _sb
        .from('notes')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', uid)
        .is('embedding', null);
      if (count === 0) {
        // Tutte già indicizzate — aggiorna il flag silenziosamente
        await _setIndexedOnServer();
        return true;
      }
      return false;
    } catch(e) { return false; }
  }

  async function _setIndexedOnServer() {
    const uid = _userId || 'default';
    try {
      await _sb
        .from(TABLE_PROFILE)
        .upsert({ user_id: uid, memory_indexed_at: new Date().toISOString() },
          { onConflict: 'user_id' });
    } catch(e) { console.warn('[MemoryManager] _setIndexedOnServer error:', e); }
  }
  // ── HELPER: EMBED TESTI VIA COHERE ──────────────────────────────────────────
  async function _embedTexts(texts) {
    if (!_cohereKey || !texts?.length) return [];
    try {
      const res = await fetch(COHERE_EMBED_URL, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + _cohereKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: EMBED_MODEL,
          texts: texts,
          input_type: 'search_document',
          embedding_types: ['float']
        })
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || res.statusText);
      }
      const data = await res.json();
      return data.embeddings?.float || [];
    } catch(e) {
      console.warn('[MemoryManager] _embedTexts error:', e);
      return [];
    }
  }

  // ── HELPER: TESTO PULITO DA UNA NOTA ────────────────────────────────────────
  function _noteToText(note) {
    const title = note.title || '';
    const content = _stripHtml(note.content || '');
    return `${title}. ${content}`.trim().slice(0, 1000);
  }

  function _stripHtml(html) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    return (tmp.textContent || tmp.innerText || '').replace(/\s+/g, ' ').trim();
  }

  function _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ── API PUBBLICA ─────────────────────────────────────────────────────────────
  return {
    init,
    indexNote,
    getContext,
    getDissonance,
    getSummary,
    hasCohereKey: () => !!_cohereKey,
    isInitialized: () => _initialized
  };

})();
