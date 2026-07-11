/* =========================================================================
   Maraude — couche de synchronisation (P1, offline-first)
   -------------------------------------------------------------------------
   - S'installe par-dessus DB.set (défini dans app.js) : chaque écriture d'une
     collection synchronisée horodate/versionne les enregistrements modifiés.
   - Suppressions = tombstones (deleted:true), jamais de suppression physique.
   - Fusion LWW par enregistrement (rev, puis updatedAt, puis deviceId).
   - Champs de santé (« Médical », notes) exclus de la synchro (RGPD).
   - 2 adaptateurs : "demo" (serveur simulé en mémoire pour tester sans backend)
     et "server" (REST type PocketBase, cf. docs/SPEC-synchro.md).
   Chargé APRÈS app.js — partage le scope global (DB, navigate, currentView…).
   ========================================================================= */
"use strict";

(function () {
  const SYNCED = ["rencontres", "stock", "maraudes", "planned", "signalements", "ressources", "personnes", "personnel", "dons"];
  const BACKUP_KEYS = ["profil", "rencontres", "stock", "maraudes", "planned", "signalements", "ressources", "personnes", "personnel", "dons", "grandFroid", "syncMode", "purgeMonths"];
  const SYNC_EXCLURE_SANTE = true; // RGPD : ne pas envoyer notes + besoin "Médical"

  /* ---------- Identité appareil ---------- */
  function deviceId() {
    let d = DB.get("deviceId", null);
    if (!d) { d = "dev-" + Math.random().toString(36).slice(2, 10); DB.set("deviceId", d); }
    return d;
  }

  /* ---------- Config ---------- */
  const Cfg = {
    mode: () => DB.get("syncMode", "off"),      // off | demo | server
    url: () => DB.get("syncUrl", ""),
    org: () => DB.get("syncOrg", "demo-asso"),
    lastAt: () => DB.get("_lastSyncAt", 0),
    cursor: () => DB.get("_syncCursor", 0),
  };

  /* ---------- Interception des écritures (stamping) ---------- */
  const _origSet = DB.set.bind(DB);
  DB.set = function (key, value) {
    if (SYNCED.includes(key) && Array.isArray(value)) {
      const prev = {};
      (DB.get(key, []) || []).forEach((x) => { if (x && x.id) prev[x.id] = x; });
      const now = Date.now(), dev = deviceId();
      value.forEach((rec) => {
        if (!rec || !rec.id) return;
        const old = prev[rec.id];
        const changed = !old || JSON.stringify(stripMeta(old)) !== JSON.stringify(stripMeta(rec));
        if (changed || rec.updatedAt == null) {
          rec.updatedAt = now;
          rec.rev = (old && old.rev ? old.rev : 0) + 1;
          rec.deviceId = dev;
        }
      });
    }
    _origSet(key, value);
    if (SYNCED.includes(key)) Sync.schedule();
    if (key !== "_autobackup") scheduleBackup();
  };
  function stripMeta(r) { const c = { ...r }; delete c.updatedAt; delete c.rev; delete c.deviceId; return c; }

  /* ---------- Sauvegarde automatique locale (filet de sécurité) ---------- */
  let _bkTimer = null;
  function scheduleBackup() { clearTimeout(_bkTimer); _bkTimer = setTimeout(doBackup, 3000); }
  function doBackup() {
    const data = { _app: "maraude", _ts: Date.now(), _v: 1 };
    BACKUP_KEYS.forEach((k) => data[k] = DB.get(k, null));
    try { _origSet("_autobackup", data); } catch (e) { /* quota */ }
  }

  /* ---------- Suppression douce (tombstone) ---------- */
  function softDelete(key, id) {
    const list = DB.get(key, []);
    const rec = list.find((x) => x.id === id);
    if (!rec) return;
    rec.deleted = true;
    DB.set(key, list); // le wrapper stampe updatedAt/rev
  }

  /* ---------- Minimisation RGPD avant envoi ---------- */
  function sanitize(collection, rec) {
    if (!SYNC_EXCLURE_SANTE) return rec;
    if (collection === "rencontres") {
      const c = { ...rec };
      delete c.notes; // notes libres = potentiellement données sensibles
      if (Array.isArray(c.besoins)) c.besoins = c.besoins.filter((b) => b !== "Médical");
      return c;
    }
    if (collection === "personnes") {
      const c = { ...rec };
      delete c.notes; // notes libres non synchronisées (RGPD)
      return c;
    }
    return rec;
  }

  /* ---------- Fusion LWW ---------- */
  function isNewer(incoming, local) {
    if (!local) return true;
    if ((incoming.rev || 0) !== (local.rev || 0)) return (incoming.rev || 0) > (local.rev || 0);
    if ((incoming.updatedAt || 0) !== (local.updatedAt || 0)) return (incoming.updatedAt || 0) > (local.updatedAt || 0);
    return String(incoming.deviceId) > String(local.deviceId); // tiebreaker déterministe
  }
  function mergeIncoming(changes) {
    let applied = 0;
    const byCol = {};
    changes.forEach((ch) => (byCol[ch.collection] ||= []).push(ch));
    Object.entries(byCol).forEach(([col, list]) => {
      const cur = DB.get(col, []);
      const idx = {}; cur.forEach((x, i) => idx[x.id] = i);
      list.forEach((ch) => {
        const rec = ch.record;
        const i = idx[rec.id];
        if (i == null) { cur.push(rec); idx[rec.id] = cur.length - 1; applied++; }
        else if (isNewer(rec, cur[i])) { cur[i] = rec; applied++; }
      });
      _origSet(col, cur); // écriture directe : pas de re-stamp des données distantes
    });
    return applied;
  }

  /* =======================================================================
     Adaptateur DÉMO — serveur simulé (localStorage "_cloud"), pour tester
     ======================================================================= */
  const DemoCloud = {
    _load: () => DB.get("_cloud", { seq: 0, records: {} }),
    _save: (c) => _origSet("_cloud", c),
    push(changes) {
      const cloud = DemoCloud._load();
      const results = [];
      changes.forEach((ch) => {
        cloud.records[ch.collection] ||= {};
        const existing = cloud.records[ch.collection][ch.record.id];
        if (!existing || isNewer(ch.record, existing.record)) {
          cloud.seq++;
          cloud.records[ch.collection][ch.record.id] = { record: ch.record, seq: cloud.seq };
          results.push({ id: ch.record.id, status: "applied", seq: cloud.seq });
        } else {
          results.push({ id: ch.record.id, status: "conflict", serverRecord: existing.record });
        }
      });
      DemoCloud._save(cloud);
      return { results };
    },
    pull(sinceSeq) {
      const cloud = DemoCloud._load();
      const changes = [];
      Object.entries(cloud.records).forEach(([col, recs]) => {
        Object.values(recs).forEach((entry) => {
          if (entry.seq > sinceSeq) changes.push({ collection: col, record: entry.record, seq: entry.seq });
        });
      });
      changes.sort((a, b) => a.seq - b.seq);
      return { changes, cursor: cloud.seq };
    },
    // Aide au test : injecte une donnée « d'un autre bénévole » directement dans le cloud
    seedOther() {
      const cloud = DemoCloud._load();
      cloud.seq++;
      const id = "r_ext_" + Math.random().toString(36).slice(2, 7);
      cloud.records.rencontres ||= {};
      cloud.records.rencontres[id] = {
        seq: cloud.seq,
        record: { id, maraudeId: "ext", date: Date.now(), benevole: "Autre bénévole",
          lieu: "Rencontre synchronisée (démo)", besoins: ["Couverture"], besoinsSante: false,
          lat: 48.8656, lng: 2.3720, rev: 1, updatedAt: Date.now(), deviceId: "dev-autre" },
      };
      DemoCloud._save(cloud);
    },
  };

  /* =======================================================================
     Adaptateur SERVEUR — REST type PocketBase (best-effort, cf. SPEC)
     ======================================================================= */
  const ServerAdapter = {
    async push(changes) {
      const res = await fetch(`${Cfg.url()}/api/sync/batch`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: deviceId(), org: Cfg.org(), changes }),
      });
      if (!res.ok) throw new Error("push " + res.status);
      return res.json();
    },
    async pull(sinceSeq) {
      const res = await fetch(`${Cfg.url()}/api/sync?since=${sinceSeq}&org=${encodeURIComponent(Cfg.org())}`);
      if (!res.ok) throw new Error("pull " + res.status);
      return res.json();
    },
  };

  function adapter() { return Cfg.mode() === "server" ? ServerAdapter : DemoCloud; }

  /* =======================================================================
     Orchestrateur
     ======================================================================= */
  let _timer = null, _running = false, _pending = false;
  const Sync = {
    softDelete,
    status: "off",

    schedule() {
      if (Cfg.mode() === "off") return;
      clearTimeout(_timer);
      _timer = setTimeout(() => Sync.run(), 1200); // regroupe les écritures rapprochées
    },

    async run() {
      if (Cfg.mode() === "off") return;
      if (_running) { _pending = true; return; } // relancer après la synchro en cours
      _running = true; setStatus("sync");
      try {
        // 1) push des enregistrements modifiés depuis la dernière synchro
        const since = Cfg.lastAt();
        const changes = [];
        SYNCED.forEach((col) => {
          DB.get(col, []).forEach((rec) => {
            if ((rec.updatedAt || 0) > since || rec.rev == null) {
              changes.push({ collection: col, record: sanitize(col, rec) });
            }
          });
        });
        if (changes.length) await Promise.resolve(adapter().push(changes));

        // 2) pull + fusion
        const pulled = await Promise.resolve(adapter().pull(Cfg.cursor()));
        const applied = pulled.changes && pulled.changes.length ? mergeIncoming(pulled.changes) : 0;
        if (pulled.cursor != null) DB.set("_syncCursor", pulled.cursor);

        DB.set("_lastSyncAt", Date.now());
        setStatus("ok");
        if (typeof toast === "function" && (changes.length || applied)) {
          toast(`Synchro : ${changes.length} envoyé(s), ${applied} reçu(s)`);
        }
        if (applied && typeof navigate === "function") navigate(currentView);
      } catch (e) {
        setStatus("error");
        if (typeof toast === "function") toast("Synchro impossible (hors-ligne ?)");
      } finally {
        _running = false;
        if (_pending) { _pending = false; Sync.run(); }
      }
    },

    demoSeedOther() { DemoCloud.seedOther(); toast("Donnée d'un autre bénévole ajoutée au cloud démo"); Sync.run(); },
    reset() { DB.set("_syncCursor", 0); DB.set("_lastSyncAt", 0); _origSet("_cloud", { seq: 0, records: {} }); toast("Cloud démo réinitialisé"); },
    isSynced: (k) => SYNCED.includes(k),
    backupNow() { doBackup(); },
    lastBackup() { const b = DB.get("_autobackup", null); return b ? b._ts : 0; },

    /* Regroupement multi-bénévoles : fusionne un fichier exporté dans les
       données locales en LWW (le plus récent gagne), sans re-stamper les
       enregistrements distants (on préserve leurs métadonnées d'origine).
       Renvoie { added, updated } ou null si le fichier n'est pas reconnu. */
    mergeFile(obj) {
      if (!obj || obj._app !== "maraude") return null;
      let added = 0, updated = 0;
      SYNCED.forEach((col) => {
        if (!Array.isArray(obj[col])) return;
        const cur = DB.get(col, []);
        const idx = {}; cur.forEach((x, i) => { if (x && x.id) idx[x.id] = i; });
        obj[col].forEach((rec) => {
          if (!rec || !rec.id) return;
          const i = idx[rec.id];
          if (i == null) { cur.push(rec); idx[rec.id] = cur.length - 1; added++; }
          else if (isNewer(rec, cur[i])) { cur[i] = rec; updated++; }
        });
        _origSet(col, cur); // pas de re-stamp : LWW conservé
      });
      return { added, updated };
    },
    restoreBackup() {
      const b = DB.get("_autobackup", null);
      if (!b || b._app !== "maraude") return false;
      BACKUP_KEYS.forEach((k) => { if (b[k] != null) _origSet(k, b[k]); });
      return true;
    },
  };

  function setStatus(s) {
    Sync.status = s;
    const el = document.getElementById("sync-status");
    if (!el) return;
    const map = { off: ["Synchro désactivée", "⚪"], sync: ["Synchro…", "🔄"], ok: ["Synchronisé", "🟢"], error: ["Hors-ligne", "🟠"] };
    const [label, ico] = map[s] || map.off;
    el.textContent = `${ico} ${label}`;
  }

  // Expose globalement
  window.Sync = Sync;

  // Init au chargement
  if (Cfg.mode() !== "off") { setStatus("off"); setTimeout(() => Sync.run(), 500); }
  else setStatus("off");
})();
