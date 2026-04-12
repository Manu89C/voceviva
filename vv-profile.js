/**
 * vv-profile.js — VoceViva Profile Manager v2
 * Gestione profilo utente, stile AI e apprendimento dai feedback.
 * Scalabile: supporta userId multipli, agnostico rispetto al modello LLM.
 */

const ProfileManager = (() => {

  // ── COSTANTI ────────────────────────────────────────────────────────────────
  const SUPABASE_URL = 'https://ezycobgovadcgvnyqcew.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_ASHxxToKJyMy4CpBAqseqA_mepXAAJ-';
  const TABLE_PROFILE      = 'vv_user_profile';
  const TABLE_INTERACTIONS = 'vv_interactions';
  const MAX_EXAMPLES       = 3;
  const DEFAULT_USER_ID    = 'default';

  // ── KEYWORDS per preferenze permanenti ──────────────────────────────────────
  const PERM_KEYWORDS = [
    'fai sempre','utilizza sempre','usa sempre','scrivi sempre','cita sempre',
    'non fare mai','non scrivere mai','non usare mai','non dimenticare mai',
    'evita sempre','ricorda sempre','non dimenticare'
  ];

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
- Il testo parla della persona in terza persona`,
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
<p>Marco descrive un ciclo ripetitivo privo di feedback positivi. Il corso di ceramica rappresenta un'eccezione significativa, conclusasi però senza integrazione nella routine quotidiana.</p>
<h3>Origine del pattern</h3>
<p>Marco individua nell'ambiente familiare l'origine delle proprie difficoltà relazionali. Una famiglia orientata all'autosufficienza individuale non ha fornito modelli adeguati per lo sviluppo di competenze empatiche e relazionali.</p>
<div id="mood-output">Isolamento sociale percepito e blocco funzionale in un soggetto con elevata autoconsapevolezza e risorse simboliche intatte.</div>`
    }
  };

  // ── STATO INTERNO ───────────────────────────────────────────────────────────
  let _sb = null;
  let _userId = DEFAULT_USER_ID;
  let _profile = null;

  // ── INIT ────────────────────────────────────────────────────────────────────
  async function init(userId = DEFAULT_USER_ID) {
    _userId = userId;
    try {
      _sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    } catch(e) {
      console.warn('[ProfileManager] Supabase non disponibile:', e);
      return false;
    }
    _profile = await _loadProfile();
    return true;
  }

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

  // ── ONBOARDING ──────────────────────────────────────────────────────────────

  function needsOnboarding() {
    return !_profile || !_profile.style_key;
  }

  /**
   * Renderizza la UI di onboarding inline dentro il container specificato.
   * Scorrimento orizzontale tra le card degli stili.
   * @param {HTMLElement} container — elemento dove inserire l'onboarding
   * @param {function} onComplete — callback(styleKey) chiamata dopo la scelta
   */
  function renderOnboarding(container, onComplete) {
    const wrapper = document.createElement('div');
    wrapper.id = 'vvp-onboarding';
    wrapper.style.cssText = `
      width:100%; box-sizing:border-box;
      background:#111118; border:1px solid rgba(245,80,54,.3);
      border-radius:.8rem; padding:1rem; margin-bottom:.8rem;
    `;

    wrapper.innerHTML = `
      <div style="font-size:.58rem;text-transform:uppercase;letter-spacing:.12em;color:rgba(255,255,255,.4);margin-bottom:.3rem;">Prima elaborazione</div>
      <div style="font-size:.95rem;font-family:'Crimson Pro',Georgia,serif;color:#fff;margin-bottom:.2rem;">Come vuoi che vengano elaborate le tue note?</div>
      <div style="font-size:.72rem;color:rgba(255,255,255,.4);margin-bottom:.8rem;">Scorri per vedere gli stili. Puoi cambiare in qualsiasi momento.</div>
      <div id="vvp-cards-scroll" style="
        display:flex; gap:.8rem; overflow-x:auto; padding-bottom:.5rem;
        scroll-snap-type:x mandatory; -webkit-overflow-scrolling:touch;
        scrollbar-width:none;
      "></div>
    `;

    const scroll = wrapper.querySelector('#vvp-cards-scroll');

    Object.entries(STYLE_TEMPLATES).forEach(([key, tpl]) => {
      const rulesLines = tpl.rules
        .split('\n')
        .filter(l => l.trim().startsWith('-'))
        .map(l => `<li style="margin-bottom:.2rem;">${l.trim().slice(1).trim()}</li>`)
        .join('');

      const card = document.createElement('div');
      card.style.cssText = `
        min-width:260px; max-width:280px; flex-shrink:0;
        border:1px solid rgba(255,255,255,.12); border-radius:.7rem;
        padding:.9rem; background:rgba(255,255,255,.03);
        scroll-snap-align:start; box-sizing:border-box;
      `;
      card.innerHTML = `
        <div style="font-family:'Crimson Pro',Georgia,serif;font-size:.95rem;color:#fff;margin-bottom:.2rem;">${tpl.name}</div>
        <div style="font-size:.68rem;color:rgba(255,255,255,.4);margin-bottom:.6rem;">${tpl.description}</div>
        <ul style="margin:0 0 .6rem 0;padding:0;list-style:none;font-size:.68rem;line-height:1.6;color:rgba(255,255,255,.5);border-left:2px solid rgba(245,80,54,.25);padding-left:.7rem;">${rulesLines}</ul>
        <div style="font-size:.62rem;text-transform:uppercase;letter-spacing:.08em;color:rgba(255,255,255,.25);margin-bottom:.3rem;">Esempio</div>
        <div style="font-size:.73rem;line-height:1.65;color:rgba(255,255,255,.55);border-left:2px solid rgba(255,255,255,.08);padding-left:.7rem;margin-bottom:.7rem;">${tpl.preview}</div>
        <button style="
          width:100%;background:rgba(245,80,54,.12);border:1px solid rgba(245,80,54,.3);
          color:#f55036;border-radius:.5rem;padding:.4rem .8rem;font-size:.72rem;
          cursor:pointer;font-family:'JetBrains Mono',monospace;
        ">Scegli ${tpl.name}</button>
      `;

      card.querySelector('button').addEventListener('click', async () => {
        card.querySelector('button').textContent = '...';
        await _saveInitialStyle(key);
        wrapper.remove();
        if (onComplete) onComplete(key);
      });

      scroll.appendChild(card);
    });

    // Inserisci prima del container o come primo figlio
    container.insertBefore(wrapper, container.firstChild);
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

    if (!error && data) _profile = data;
  }

  // ── BUILD SYSTEM PROMPT ─────────────────────────────────────────────────────
  function buildSystemPrompt(basePrompt) {
    if (!_profile) return basePrompt;

    let prompt = basePrompt;

    if (_profile.system_prompt_additions) {
      prompt += '\n\n' + _profile.system_prompt_additions;
    }

    const examples = _profile.examples || [];
    if (examples.length > 0) {
      prompt += '\n\nESEMPI DI RIFERIMENTO (segui questo stile):\n';
      examples.forEach((ex, i) => {
        prompt += `\n--- Esempio ${i + 1} ---\nInput: ${ex.input.slice(0, 300)}...\nOutput atteso:\n${ex.output}\n`;
      });
    }

    return prompt;
  }

  // ── AGGIORNA REGOLE DAL FEEDBACK ────────────────────────────────────────────
  /**
   * Chiamata separata: analizza feedback, aggiorna system_prompt_additions
   * risolvendo conflitti con le regole esistenti.
   * @param {string} feedbackText
   * @param {string} groqKey
   * @returns {string|null} regole aggiornate, o null se nessuna preferenza permanente
   */
  async function analyzeFeedback(feedbackText, groqKey) {
    const hasPermanent = PERM_KEYWORDS.some(k => feedbackText.toLowerCase().includes(k));
    if (!hasPermanent) return null;

    const currentRules = _profile?.system_prompt_additions || '';

    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST', cache: 'no-store',
        headers: { 'Authorization': 'Bearer ' + groqKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'meta-llama/llama-4-scout-17b-16e-instruct',
          max_tokens: 400,
          temperature: 0.1,
          messages: [{
            role: 'system',
            content: 'Sei un assistente che gestisce regole stilistiche per un\'AI di scrittura. Ricevi le regole attuali e un nuovo feedback utente. Devi restituire le regole aggiornate: aggiungi le nuove preferenze permanenti ed elimina o sostituisci quelle in conflitto. Rispondi SOLO con il testo aggiornato delle regole, senza commenti. Se non ci sono preferenze permanenti nel feedback, rispondi con la parola NESSUNA.'
          }, {
            role: 'user',
            content: `Regole attuali:\n${currentRules}\n\nNuovo feedback utente: "${feedbackText}"\n\nRestituisci le regole aggiornate, risolvendo eventuali conflitti.`
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

  // ── SALVA REGOLE AGGIORNATE ─────────────────────────────────────────────────
  /**
   * Aggiorna solo le regole nel profilo (chiamato dal Raffina).
   * @param {string} updatedRules
   */
  async function updateRules(updatedRules) {
    if (!_profile || !updatedRules) return;

    const updated = {
      system_prompt_additions: updatedRules,
      updated_at: new Date().toISOString()
    };

    const { data, error } = await _sb
      .from(TABLE_PROFILE)
      .update(updated)
      .eq('user_id', _userId)
      .select()
      .single();

    if (!error && data) _profile = data;
  }

  // ── SALVA ESEMPIO APPROVATO ─────────────────────────────────────────────────
  /**
   * Salva un esempio approvato (chiamato al salvataggio nel diario).
   */
  async function saveApprovedExample(inputText, outputHtml, extractedRules = null, feedbackText = '') {
    if (!_profile) return;

    const examples = [...(_profile.examples || [])];
    examples.push({ input: inputText.slice(0, 500), output: outputHtml, source: 'approved' });
    const realExamples = examples.filter(e => e.source === 'approved');
    const kept = realExamples.length >= MAX_EXAMPLES
      ? realExamples.slice(-MAX_EXAMPLES)
      : examples.slice(-MAX_EXAMPLES);

    let additions = _profile.system_prompt_additions || '';
    if (extractedRules) additions = extractedRules; // sostituisce, non appende

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

    if (!error && data) _profile = data;

    // Archivio interazioni
    try {
      await _sb.from(TABLE_INTERACTIONS).insert({
        user_id: _userId,
        input_text: inputText.slice(0, 1000),
        output_html: outputHtml,
        feedback_text: feedbackText,
        extracted_rules: extractedRules || '',
        created_at: new Date().toISOString()
      });
    } catch(e) {}
  }

  // ── GETTERS ─────────────────────────────────────────────────────────────────
  function getProfile() { return _profile; }
  function getStyleKey() { return _profile?.style_key || null; }
  function getStyleName() {
    const key = getStyleKey();
    return key ? STYLE_TEMPLATES[key]?.name || key : null;
  }
  function getStyleTemplates() { return STYLE_TEMPLATES; }
  async function changeStyle(styleKey) { await _saveInitialStyle(styleKey); }

  return {
    init,
    needsOnboarding,
    renderOnboarding,
    buildSystemPrompt,
    analyzeFeedback,
    updateRules,
    saveApprovedExample,
    getProfile,
    getStyleKey,
    getStyleName,
    getStyleTemplates,
    changeStyle
  };

})();
