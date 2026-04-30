/**
 * vv-auth.js — VoceViva Auth Manager
 * Gestisce la sessione utente con Supabase Auth.
 * Caricare PRIMA di vv-profile.js, vv-memory.js, vv-report.js.
 */
const VvAuth = (() => {

  const LOGIN_PAGE = 'login.html';

  /**
   * Verifica la sessione Supabase corrente.
   * Se l'utente NON è autenticato, reindirizza a login.html.
   * Se è il primo accesso da questo dispositivo, migra i dati 'default'.
   *
   * @param {object} sb - istanza Supabase già creata dalla pagina
   * @returns {{ userId: string|null }}
   */
  async function init(sb) {
    if (!sb) return { userId: null };

    try {
      const { data: { session } } = await sb.auth.getSession();
      const userId = session?.user?.id || null;

      if (!userId) {
        // Non autenticato → vai al login (a meno che non ci siamo già)
        const path = window.location.pathname;
        if (!path.endsWith(LOGIN_PAGE) && !path.endsWith('/login')) {
          window.location.replace(LOGIN_PAGE);
        }
        return { userId: null };
      }

      // Prima volta che questo account usa questo dispositivo:
      // migra i dati storici con user_id='default' o NULL
      const migKey = 'vv_migrated_' + userId;
      if (!localStorage.getItem(migKey)) {
        try {
          await sb.rpc('vv_migrate_default', { new_uid: userId });
        } catch(e) { /* nulla da migrare o funzione non ancora disponibile */ }
        localStorage.setItem(migKey, '1');
      }

      return { userId };

    } catch(e) {
      console.warn('[VvAuth] init error:', e);
      return { userId: null };
    }
  }

  /**
   * Disconnette l'utente e reindirizza a login.html.
   * @param {object} sb - istanza Supabase
   */
  async function signOut(sb) {
    try { if (sb) await sb.auth.signOut(); } catch(e) {}
    window.location.replace(LOGIN_PAGE);
  }

  return { init, signOut };
})();
