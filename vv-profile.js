/**
 * vv-profile.js — VoceViva Profile Manager
 * Gestione profilo utente, stile AI e apprendimento dai feedback.
 * Scalabile: supporta userId multipli, agnostico rispetto al modello LLM.
 *
 * Dipendenze: @supabase/supabase-js@2 (deve essere già caricato nella pagina)
 * Uso: await ProfileManager.init(); poi usa ProfileManager.buildSystemPrompt(base)
 */

const ProfileManager = (() => {

  // ── COSTANTI ────────────────────────────────────────────────────────────────

  const SUPABASE_URL = 'https://ezycobgovadcgvnyqcew.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_ASHxxToKJyMy4CpBAqseqA_mepXAAJ-';
  const TABLE_PROFILE      = 'vv_user_profile';
  const TABLE_INTERACTIONS = 'vv_interactions';
  const MAX_EXAMPLES       = 3;
  const DEFAULT_USER_ID    = 'default';

  // ── TEMPLATE STILI ──────────────────────────────────────────────────────────

  const STYLE_TEMPLATES = {
    terapeutico: {
      name: 'Terapeutico',
      description: 'Paragrafi distesi, domande aperte, vicinanza emotiva.',
      preview: `<h3>Il peso del silenzio</h3>
<p>Marco attraversa un periodo in cui la fatica non è fisica — è la fatica di chi continua a tendere la mano senza che nessuno la prenda. Il corso di ceramica aveva aperto qualcosa di reale. Vale la pena chiedersi: cosa ha permesso a quell'esperienza di funzionare?</p>
<h3>Le relazioni che non tornano</h3>
<p>Con Lorenzo è sempre stato Marco a cercare. Questa asimmetria produce una domanda dolorosa — ho sbagliato qualcosa? — che nasconde qualcosa di più importante: il bisogno di capire se sia degno di essere cercato, non solo trovato.</p>`,
      rules: `STILE RICHIESTO: Terapeutico.
- Tono caldo e non giudicante, mai consolatorio in modo banale
- Paragrafi distesi, 4-6 righe ciascuno
- Le sezioni aprono domande implicite invece di chiuderle
- I dettagli concreti (nomi, luoghi, episodi) vengono usati come punti di accesso emotivo
- Mai frasi generiche come "è normale sentirsi così"
- Il testo parla della persona in terza persona ma con vicinanza`,
      example_input: `Oggi mi sono svegliato e non avevo voglia di fare niente. Ho chiamato Lorenzo ma non ha risposto. Ho provato ad andare al corso di ceramica ma era annullato. Mi sento sempre così, come se non contassi niente per nessuno. Forse è colpa mia, forse non so come stare con le persone. In famiglia eravamo tutti un po' solitari. Non so dove sto andando.`,
      example_output: `<h2>Il Peso del Silenzio</h2>
<p>Marco attraversa un periodo in cui la fatica non è fisica — è la fatica di chi continua a tendere la mano senza che nessuno la prenda. Non si sente semplicemente solo. Si sente trasparente: presente nelle conversazioni, incluso nelle situazioni, ma mai davvero trattenuto.</p>
<h3>Le relazioni che non tornano</h3>
<p>Con Lorenzo è sempre stato Marco a cercare, a scrivere, a proporre. Lorenzo non ha mai fatto il gesto opposto. Da quando ha cambiato abitudini, il silenzio è diventato totale. Marco non riesce a identificare un errore preciso. Il che, paradossalmente, rende tutto più difficile da elaborare.</p>
<h3>I tentativi che evaporano</h3>
<p>Il corso annullato, il messaggio rimasto senza risposta. Singolarmente sono episodi banali. Ma per chi è già in un momento di fragilità, ogni cancellazione diventa la conferma di una narrativa che si sta consolidando: non conto abbastanza. Riconoscere questo meccanismo è il primo passo per non lasciargli troppo potere.</p>
<h2>Le Origini</h2>
<p>Marco riconduce parte di questa difficoltà alla propria storia familiare — un ambiente in cui ognuno affrontava le difficoltà in modo autonomo. Questa consapevolezza non è un atto d'accusa. È uno spazio nuovo da cui ricominciare.</p>
<div id="mood-output">La stanchezza di chi ha continuato a bussare a porte che non si sono aperte — ma non ha ancora smesso di cercare la propria.</div>`
    },

    narrativo: {
      name: 'Narrativo',
      description: 'Terza persona, stile letterario, conciso e denso.',
      preview: `<h3>La frequenza sbagliata</h3>
<p>Marco si muoveva tra le persone con la costante impressione di abitare una frequenza che nessun apparecchio riusciva a ricevere. Non invisibile — trasparente.</p>
<h3>Lorenzo</h3>
<p>Con Lorenzo era sempre stato lui ad andare, sempre lui a cercare. <em>Sono in città, ti vengo a trovare</em> — una frase che non era mai arrivata. Probabilmente non c'era stato nessun errore. Ma saperlo non alleggeriva niente.</p>`,
      rules: `STILE RICHIESTO: Narrativo.
- Terza persona, tono letterario, distaccato ma denso
- Paragrafi brevi e concisi, massimo 3-4 righe
- Nessuna interpretazione psicologica esplicita — i fatti parlano da soli
- I nomi propri, luoghi ed episodi non vengono mai generalizzati
- Stile memorie letterarie — come se si leggesse il diario di qualcun altro
- Niente tono consolatorio, niente domande aperte`,
      example_input: `Oggi mi sono svegliato e non avevo voglia di fare niente. Ho chiamato Lorenzo ma non ha risposto. Ho provato ad andare al corso di ceramica ma era annullato. Mi sento sempre così, come se non contassi niente per nessuno. Forse è colpa mia, forse non so come stare con le persone. In famiglia eravamo tutti un po' solitari. Non so dove sto andando.`,
      example_output: `<h2>La Frequenza Sbagliata</h2>
<h3>Trasparente</h3>
<p>Marco si muoveva tra le persone con la costante impressione di abitare una frequenza che nessun apparecchio riusciva a ricevere. Non invisibile — trasparente. Gli sguardi lo sfioravano senza fermarsi, le conversazioni lo includevano senza trattenerlo.</p>
<h3>Lorenzo</h3>
<p>Con Lorenzo era sempre stato lui ad andare, sempre lui a cercare. Sono in città, ti vengo a trovare — una frase che non era mai arrivata. Da quando Lorenzo aveva cambiato abitudini i messaggi si erano diradati fino a sparire. Rimase la domanda: aveva sbagliato qualcosa? Probabilmente no. Ma saperlo non alleggeriva niente.</p>
<h2>Il Circolo</h2>
<h3>Lavoro, casa, tentativi</h3>
<p>Il corso di ceramica era stata un'eccezione — per qualche mese Marco aveva sentito di stare costruendo un linguaggio che gli apparteneva. Poi era finito, e con lui quella sensazione. In una famiglia dove ognuno affrontava le difficoltà in solitaria, aveva imparato l'autosufficienza prima dell'interdipendenza.</p>
<p>Non sapeva dove stava andando. Continuava a muoversi lo stesso.</p>
<div id="mood-output">Un uomo che abita il bordo delle cose — né dentro né fuori — e continua a muoversi lo stesso.</div>`
    },

    analitico: {
      name: 'Analitico',
      description: 'Strutturato, oggettivo, linguaggio preciso.',
      preview: `<h3>Dinamiche di isolamento sociale</h3>
<p>Marco riporta una percezione persistente di trasparenza sociale — presente nelle interazioni senza lasciare un impatto reale. Il rapporto con Lorenzo esemplifica una dinamica ricorrente: Marco assume sistematicamente il ruolo di chi inizia il contatto senza ricevere reciprocità.</p>
<h3>Pattern relazionale</h3>
<p>Una serie di episodi recenti contribuisce a consolidare la percezione di esclusione sistematica. Marco individua nell'ambiente familiare l'origine delle proprie difficoltà relazionali — una famiglia orientata all'autosufficienza individuale.</p>`,
      rules: `STILE RICHIESTO: Analitico.
- Tono oggettivo e strutturato, come un'analisi psicologica accessibile
- Sezioni ben definite con titoli descrittivi e diretti
- Ogni sezione identifica un tema, lo descrive e lo contestualizza
- Nessun coinvolgimento emotivo esplicito del narratore
- Linguaggio preciso, niente metafore o immagini evocative`,
      example_input: `Oggi mi sono svegliato e non avevo voglia di fare niente. Ho chiamato Lorenzo ma non ha risposto. Ho provato ad andare al corso di ceramica ma era annullato. Mi sento sempre così, come se non contassi niente per nessuno. Forse è colpa mia, forse non so come stare con le persone. In famiglia eravamo tutti un po' solitari. Non so dove sto andando.`,
      example_output: `<h2>Dinamiche di Isolamento Sociale</h2>
<h3>Percezione di invisibilità</h3>
<p>Marco riporta una percezione persistente di trasparenza sociale — la sensazione di essere presente nelle interazioni senza lasciare un impatto reale. Questo si manifesta nel timore di non essere cercato, segnale di una rete sociale percepita come insufficiente.</p>
<h3>Pattern relazionale asimmetrico</h3>
<p>Il rapporto con Lorenzo esemplifica una dinamica ricorrente: Marco assume sistematicamente il ruolo di chi inizia il contatto, senza ricevere reciprocità. Il tentativo di raggiungere Lorenzo è rimasto senza risposta. Marco attribuisce questo alla propria condotta, pur non identificando un errore specifico.</p>
<h2>Blocco Funzionale</h2>
<h3>Assenza di rinforzo positivo</h3>
<p>Marco descrive un ciclo ripetitivo privo di feedback positivi. Il corso di ceramica rappresenta un'eccezione significativa, conclusasi però senza integrazione nella routine quotidiana. L'annullamento odierno del corso rinforza la percezione di sistematica esclusione.</p>
<h3>Origine del pattern</h3>
<p>Marco individua nell'ambiente familiare l'origine delle proprie difficoltà relazionali. Una famiglia orientata all'autosufficienza individuale non ha fornito modelli adeguati per lo sviluppo di competenze empatiche e relazionali.</p>
<div id="mood-output">Isolamento sociale percepito e blocco funzionale in un soggetto con elevata autoconsapevolezza e risorse simboliche intatte.</div>`
    }
  };

  // ── STATO INTERNO ───────────────────────────────────────────────────────────

  let _sb = null;
  let _userId = DEFAULT_USER_ID;
  let _profile = null; // cache del profilo corrente

  // ── INIT ────────────────────────────────────────────────────────────────────

  async function init(userId = DEFAULT_USER_ID) {
    _userId = userId;
    try {
      _sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    } catch(e) {
      console.warn('[ProfileManager] Supabase non disponibile:', e);
      return false;
    }
    await _ensureTables();
    _profile = await _loadProfile();
    return true;
  }

  // ── SETUP TABELLE (idempotente) ──────────────────────────────────────────────
  // Le tabelle vengono create manualmente su Supabase — questa funzione
  // verifica solo che il profilo esista, non crea le tabelle via JS.

  async function _ensureTables() {
    // Verifica se esiste già un profilo per questo userId
    const { data } = await _sb
      .from(TABLE_PROFILE)
      .select('id')
      .eq('user_id', _userId)
      .single();
    // Se non esiste, non fa nulla — il profilo viene creato al primo salvataggio
    return !!data;
  }

  // ── LOAD PROFILO ────────────────────────────────────────────────────────────

  async function _loadProfile() {
    try {
      const { data } = await _sb
        .from(TABLE_PROFILE)
        .select('*')
        .eq('user_id', _userId)
        .single();
      return data || null;
    } catch(e) {
      return null;
    }
  }

  // ── ONBOARDING — richiede scelta stile ─────────────────────────────────────

  function needsOnboarding() {
    return !_profile || !_profile.style_key;
  }

  /**
   * Renderizza la UI di onboarding nel container specificato.
   * @param {HTMLElement} container
   * @param {function} onComplete — callback chiamata con lo stile scelto
   */
  function renderOnboarding(container, onComplete) {
    container.innerHTML = '';

    const wrapper = document.createElement('div');
    wrapper.style.cssText = `
      position:fixed; inset:0; background:rgba(0,0,0,.85); z-index:9999;
      display:flex; flex-direction:column; align-items:center; justify-content:center;
      padding:1.5rem; box-sizing:border-box; overflow-y:auto;
    `;

    const card = document.createElement('div');
    card.style.cssText = `
      background:#1a1a1a; border:1px solid rgba(255,255,255,.1); border-radius:1rem;
      padding:1.5rem; max-width:680px; width:100%;
    `;

    card.innerHTML = `
      <div style="font-size:.65rem;text-transform:uppercase;letter-spacing:.12em;color:rgba(255,255,255,.4);margin-bottom:.4rem;">Benvenuto in VoceViva</div>
      <div style="font-size:1.1rem;font-family:'Crimson Pro',Georgia,serif;color:#fff;margin-bottom:.3rem;">Come vuoi che vengano elaborate le tue note?</div>
      <div style="font-size:.8rem;color:rgba(255,255,255,.45);margin-bottom:1.2rem;">Puoi cambiare stile in qualsiasi momento dalle impostazioni.</div>
      <div id="vvp-style-cards" style="display:flex;flex-direction:column;gap:.8rem;"></div>
    `;

    const cardsContainer = card.querySelector('#vvp-style-cards');

    Object.entries(STYLE_TEMPLATES).forEach(([key, tpl]) => {
      const styleCard = document.createElement('div');
      styleCard.style.cssText = `
        border:1px solid rgba(255,255,255,.12); border-radius:.8rem;
        padding:1rem; cursor:pointer; transition:border-color .15s;
        background:rgba(255,255,255,.03);
      `;
      // Estrai le regole dal campo rules (salta la prima riga "STILE RICHIESTO:")
      const rulesLines = tpl.rules
        .split('\n')
        .filter(l => l.trim().startsWith('-'))
        .map(l => `<li style="margin-bottom:.2rem;">${l.trim().slice(1).trim()}</li>`)
        .join('');

      styleCard.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:.6rem;">
          <span style="font-family:'Crimson Pro',Georgia,serif;font-size:1rem;color:#fff;">${tpl.name}</span>
          <span style="font-size:.72rem;color:rgba(255,255,255,.4);">${tpl.description}</span>
        </div>
        <ul style="
          margin:0 0 .8rem 0; padding:0;
          list-style:none;
          font-size:.72rem; line-height:1.6; color:rgba(255,255,255,.5);
          border-left:2px solid rgba(245,80,54,.25); padding-left:.8rem;
        ">${rulesLines}</ul>
        <div style="
          font-size:.75rem;text-transform:uppercase;letter-spacing:.08em;
          color:rgba(255,255,255,.25);margin-bottom:.4rem;
        ">Esempio</div>
        <div style="font-size:.78rem;line-height:1.7;color:rgba(255,255,255,.6);border-left:2px solid rgba(255,255,255,.08);padding-left:.8rem;margin-bottom:.8rem;">
          ${tpl.preview}
        </div>
        <button data-key="${key}" style="
          background:rgba(245,80,54,.12);border:1px solid rgba(245,80,54,.3);
          color:#f55036;border-radius:.5rem;padding:.4rem 1rem;font-size:.75rem;
          cursor:pointer;width:100%;
        ">Scegli ${tpl.name}</button>
      `;

      styleCard.querySelector('button').addEventListener('click', async () => {
        await _saveInitialStyle(key);
        wrapper.remove();
        if (onComplete) onComplete(key);
      });

      styleCard.addEventListener('mouseenter', () => {
        styleCard.style.borderColor = 'rgba(245,80,54,.4)';
      });
      styleCard.addEventListener('mouseleave', () => {
        styleCard.style.borderColor = 'rgba(255,255,255,.12)';
      });

      cardsContainer.appendChild(styleCard);
    });

    wrapper.appendChild(card);
    document.body.appendChild(wrapper);
  }

  // ── SALVA STILE INIZIALE ────────────────────────────────────────────────────

  async function _saveInitialStyle(styleKey) {
    const tpl = STYLE_TEMPLATES[styleKey];
    if (!tpl) return;

    const initialExample = {
      input: tpl.example_input,
      output: tpl.example_output,
      source: 'template'
    };

    const profileData = {
      user_id: _userId,
      style_key: styleKey,
      system_prompt_additions: tpl.rules,
      examples: [initialExample],
      updated_at: new Date().toISOString()
    };

    const { data, error } = await _sb
      .from(TABLE_PROFILE)
      .upsert(profileData, { onConflict: 'user_id' })
      .select()
      .single();

    if (!error) _profile = data;
  }

  // ── BUILD SYSTEM PROMPT ─────────────────────────────────────────────────────

  /**
   * Costruisce il system prompt completo: base + regole profilo + esempi few-shot.
   * @param {string} basePrompt — il prompt base dell'app
   * @returns {string}
   */
  function buildSystemPrompt(basePrompt) {
    if (!_profile) return basePrompt;

    let prompt = basePrompt;

    // Aggiungi regole stile e preferenze accumulate
    if (_profile.system_prompt_additions) {
      prompt += '\n\n' + _profile.system_prompt_additions;
    }

    // Aggiungi esempi few-shot
    const examples = _profile.examples || [];
    if (examples.length > 0) {
      prompt += '\n\nESEMPI DI RIFERIMENTO (segui questo stile):\n';
      examples.forEach((ex, i) => {
        prompt += `\n--- Esempio ${i + 1} ---\nInput: ${ex.input.slice(0, 300)}...\nOutput atteso:\n${ex.output}\n`;
      });
    }

    return prompt;
  }

  // ── ANALIZZA FEEDBACK ───────────────────────────────────────────────────────

  /**
   * Chiamata 1: analizza il feedback e estrae preferenze permanenti.
   * @param {string} feedbackText
   * @param {string} groqKey
   * @returns {string|null} — regole estratte in markdown, o null se nessuna preferenza permanente
   */
  async function analyzeFeedback(feedbackText, groqKey) {
    const KEYWORDS = ['fai sempre', 'utilizza sempre', 'non fare mai', 'non dimenticare', 'evita sempre', 'ricorda sempre'];
    const hasPermanent = KEYWORDS.some(k => feedbackText.toLowerCase().includes(k));
    if (!hasPermanent) return null;

    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST', cache: 'no-store',
        headers: { 'Authorization': 'Bearer ' + groqKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'meta-llama/llama-4-scout-17b-16e-instruct',
          max_tokens: 300,
          temperature: 0.1,
          messages: [{
            role: 'system',
            content: 'Sei un assistente che estrae preferenze stilistiche permanenti da feedback utente. Rispondi SOLO con un elenco markdown di regole brevi (- regola). Se non ci sono preferenze permanenti, rispondi con la parola NESSUNA.'
          }, {
            role: 'user',
            content: `Feedback utente: "${feedbackText}"\n\nEstrai solo le preferenze permanenti (frasi come "fai sempre", "non fare mai", "utilizza sempre", ecc.). Scrivi regole brevi e chiare.`
          }]
        })
      });
      if (!res.ok) return null;
      const raw = (await res.json()).choices?.[0]?.message?.content?.trim() || '';
      if (raw === 'NESSUNA' || raw === '') return null;
      return raw;
    } catch(e) {
      console.warn('[ProfileManager] analyzeFeedback error:', e);
      return null;
    }
  }

  // ── SALVA ESEMPIO APPROVATO ─────────────────────────────────────────────────

  /**
   * Salva un esempio approvato nel profilo. Mantiene max MAX_EXAMPLES esempi.
   * @param {string} inputText — testo originale
   * @param {string} outputHtml — elaborazione approvata
   * @param {string|null} extractedRules — regole estratte dal feedback
   * @param {string} feedbackText — feedback originale
   */
  async function saveApprovedExample(inputText, outputHtml, extractedRules = null, feedbackText = '') {
    if (!_profile) return;

    // Aggiorna esempi
    const examples = [...(_profile.examples || [])];
    examples.push({ input: inputText.slice(0, 500), output: outputHtml, source: 'approved' });
    // Mantieni solo gli ultimi MAX_EXAMPLES, escludi i template se ci sono esempi reali
    const realExamples = examples.filter(e => e.source === 'approved');
    const kept = realExamples.length >= MAX_EXAMPLES
      ? realExamples.slice(-MAX_EXAMPLES)
      : examples.slice(-MAX_EXAMPLES);

    // Aggiorna regole
    let additions = _profile.system_prompt_additions || '';
    if (extractedRules) {
      additions += '\n\nPreferenze aggiornate:\n' + extractedRules;
    }

    const updated = {
      examples: kept,
      system_prompt_additions: additions,
      updated_at: new Date().toISOString()
    };

    const { data, error } = await _sb
      .from(TABLE_PROFILE)
      .update(updated)
      .eq('user_id', _userId)
      .select()
      .single();

    if (!error) _profile = data;

    // Salva nell'archivio interazioni
    await _sb.from(TABLE_INTERACTIONS).insert({
      user_id: _userId,
      input_text: inputText.slice(0, 1000),
      output_html: outputHtml,
      feedback_text: feedbackText,
      extracted_rules: extractedRules || '',
      created_at: new Date().toISOString()
    });
  }

  // ── GETTERS PUBBLICI ────────────────────────────────────────────────────────

  function getProfile() { return _profile; }
  function getStyleKey() { return _profile?.style_key || null; }
  function getStyleName() {
    const key = getStyleKey();
    return key ? STYLE_TEMPLATES[key]?.name || key : null;
  }
  function getStyleTemplates() { return STYLE_TEMPLATES; }

  /**
   * Cambia stile e resetta gli esempi al template predefinito.
   * @param {string} styleKey
   */
  async function changeStyle(styleKey) {
    await _saveInitialStyle(styleKey);
  }

  // ── API PUBBLICA ─────────────────────────────────────────────────────────────

  return {
    init,
    needsOnboarding,
    renderOnboarding,
    buildSystemPrompt,
    analyzeFeedback,
    saveApprovedExample,
    getProfile,
    getStyleKey,
    getStyleName,
    getStyleTemplates,
    changeStyle
  };

})();
