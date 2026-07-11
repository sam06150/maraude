/* =========================================================================
   Maraude — logique applicative (vanilla JS, offline-first via localStorage)
   ========================================================================= */
"use strict";

/* ---------- Stockage local ---------- */
const DB = {
  _key: (k) => "maraude:" + k,
  get(k, def) {
    try { const v = localStorage.getItem(DB._key(k)); return v ? JSON.parse(v) : def; }
    catch { return def; }
  },
  set(k, v) { localStorage.setItem(DB._key(k), JSON.stringify(v)); },
};

/* Amorçage des ressources la première fois */
if (!DB.get("ressources")) DB.set("ressources", window.SEED_RESSOURCES);
/* Mot de passe d'accès Admin — défini par défaut à "123456", modifiable dans Réglages */
if (!DB.get("adminPassHash")) DB.set("adminPassHash", hashPin("123456"));
if (!DB.get("stock")) DB.set("stock", [
  { id: uid(), nom: "Couvertures", categorie: "Couchage", qte: 24, seuil: 10 },
  { id: uid(), nom: "Kits hygiène", categorie: "Hygiène", qte: 18, seuil: 8 },
  { id: uid(), nom: "Sandwichs", categorie: "Alimentaire", qte: 40, seuil: 15 },
  { id: uid(), nom: "Café / thé (portions)", categorie: "Boisson", qte: 30, seuil: 12 },
]);

/* ---------- Utilitaires ---------- */
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
/* Suppression : tombstone si la couche de synchro est là, sinon retrait direct */
function delItem(key, id) {
  if (window.Sync && Sync.isSynced(key)) return Sync.softDelete(key, id);
  DB.set(key, DB.get(key, []).filter((x) => x.id !== id));
}
/* Filtre les enregistrements marqués supprimés (tombstones) */
function notDeleted(arr) { return (arr || []).filter((x) => !x.deleted); }
/* Stock disponible (qte > 0) pour la distribution terrain */
function stockAvailable() { return notDeleted(DB.get("stock", [])).filter((s) => s.qte > 0); }
function stockLabel(s) { return `${s.nom}${s.taille ? " · T." + s.taille : ""} (reste ${s.qte})`; }
/* Journal des dons (daté) */
function getDons() { return notDeleted(DB.get("dons", [])).sort((a, b) => (b.date || 0) - (a.date || 0)); }
function logDon(don) { const list = DB.get("dons", []); list.push(don); DB.set("dons", list); }
function $(sel, root = document) { return root.querySelector(sel); }
function $all(sel, root = document) { return [...root.querySelectorAll(sel)]; }
function esc(s) { return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function fmtDate(ts) {
  return new Date(ts).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg; t.classList.remove("hidden");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add("hidden"), 2200);
}

/* ---------- Modale ---------- */
const Modal = {
  open(title, html, onMount) {
    $("#modal-title").textContent = title;
    $("#modal-body").innerHTML = html;
    $("#modal-backdrop").classList.remove("hidden");
    if (onMount) onMount($("#modal-body"));
    const first = $("#modal-body input, #modal-body select, #modal-body textarea, #modal-body button");
    if (first) setTimeout(() => first.focus(), 50);
  },
  close() { $("#modal-backdrop").classList.add("hidden"); $("#modal-body").innerHTML = ""; },
};

/* =========================================================================
   Routeur de vues
   ========================================================================= */
const VIEWS = {
  terrain: { title: "Terrain", render: renderTerrain },
  personnes: { title: "Personnes à la rue", render: renderPersonnes },
  signalements: { title: "Signalements", render: renderSignalements },
  coordination: { title: "Coordination", render: renderCoordination },
  stock: { title: "Stock embarqué", render: renderStock },
  ressources: { title: "Ressources", render: renderRessources },
  carte: { title: "Carte globale", render: renderCarteGlobale },
  admin: { title: "Admin / Personnel", render: renderAdmin },
};
let currentView = "terrain";
let mapInstance = null;
let adminUnlocked = false; // déverrouillage admin valable le temps de la session

function navigate(view) {
  if (!VIEWS[view]) return;
  // Accès Admin protégé par mot de passe (le temps de la session)
  if (view === "admin" && DB.get("adminPassHash", "") && !adminUnlocked) {
    promptAdminPass(() => { adminUnlocked = true; navigate("admin"); });
    return;
  }
  currentView = view;
  if (mapInstance) { mapInstance.remove(); mapInstance = null; }
  $("#view-title").textContent = VIEWS[view].title;
  $all(".nav-btn, .tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  $("#sidebar").classList.remove("open");
  $("#view").innerHTML = "";
  VIEWS[view].render($("#view"));
}

/* =========================================================================
   VUE 1 — TERRAIN (carte + rencontres pendant la tournée)
   ========================================================================= */
function renderTerrain(root) {
  const active = DB.get("maraudeActive", null);
  const rencontres = notDeleted(DB.get("rencontres", [])).filter((r) => !active || r.maraudeId === active.id);

  root.innerHTML = `
    ${!active ? `
      <div class="card" style="text-align:center">
        <p class="muted">Aucune maraude en cours. Démarre une tournée pour enregistrer tes rencontres.</p>
        <button class="btn" id="start-maraude">▶ Démarrer une maraude</button>
      </div>` : `
      <div class="section-head">
        <div>
          <span class="chip chip-ok">● En cours</span>
          <span class="muted">Secteur ${esc(active.secteur)} · démarrée ${fmtDate(active.debut)}</span>
        </div>
        <div style="display:flex;gap:8px">
          ${rencontres.filter((r) => r.lat && r.lng).length >= 2 ? `<button class="btn secondary small" id="tour-btn">🛣️ Tournée optimisée</button>` : ""}
          <button class="btn secondary small" id="stop-maraude">■ Clôturer</button>
        </div>
      </div>`}
    <div id="map" style="margin:14px 0"></div>
    ${active ? `<button class="btn block" id="add-rencontre">＋ Nouvelle rencontre</button>` : ""}
    <div class="section-head" style="margin-top:20px"><h2>Rencontres (${rencontres.length})</h2></div>
    <div class="list" id="rencontre-list">
      ${rencontres.length ? rencontres.slice().reverse().map(rencontreCard).join("") :
        `<div class="empty"><span class="big">🧭</span>Aucune rencontre enregistrée.</div>`}
    </div>`;

  // Carte
  const map = initMap("map", [48.8606, 2.3776], 14);
  rencontres.forEach((r) => {
    if (r.lat && r.lng) L.marker([r.lat, r.lng]).addTo(map)
      .bindPopup(`<b>${esc(r.lieu || "Rencontre")}</b><br>${(r.besoins || []).map(esc).join(", ")}`);
  });

  if ($("#start-maraude")) $("#start-maraude").onclick = openStartMaraude;
  if ($("#stop-maraude")) $("#stop-maraude").onclick = stopMaraude;
  if ($("#tour-btn")) $("#tour-btn").onclick = () => openTourneeOptimisee(map, rencontres);
  if ($("#add-rencontre")) {
    map.on("click", (e) => openRencontreForm(e.latlng));
    $("#add-rencontre").onclick = () => openRencontreForm(map.getCenter());
  }
  $all("[data-del-rencontre]").forEach((b) => b.onclick = () => {
    delItem("rencontres", b.dataset.delRencontre);
    toast("Rencontre supprimée"); navigate("terrain");
  });
  $all("[data-open-person]").forEach((b) => b.onclick = (e) => { e.stopPropagation(); openPersonDetail(b.dataset.openPerson); });
}

function rencontreCard(r) {
  return `<div class="item">
    <div class="item-ico">📍</div>
    <div class="item-body">
      <div class="item-title">${esc(r.lieu || "Lieu non précisé")}</div>
      <div class="item-sub">${fmtDate(r.date)}${r.prenom ? " · " + esc(r.prenom) : ""}${r.benevole ? " · par " + esc(r.benevole) : ""}</div>
      <div class="item-tags">
        ${r.personneId ? `<button class="chip chip-ok" data-open-person="${r.personneId}" style="cursor:pointer">👤 ${esc(personName(r.personneId))}</button>` : ""}
        ${(r.besoins || []).map((b) => `<span class="chip">${esc(b)}</span>`).join("")}
        ${r.orientation ? `<span class="chip chip-ok">➜ ${esc(r.orientation)}</span>` : ""}
        ${(r.distributions || []).length ? `<span class="chip chip-ok">🎁 ${r.distributions.reduce((n, d) => n + d.qte, 0)} distribué(s)</span>` : ""}
      </div>
      ${r.notes ? `<div class="item-sub" style="margin-top:6px">📝 ${esc(r.notes)}</div>` : ""}
    </div>
    <div class="item-actions"><button class="icon-btn" data-del-rencontre="${r.id}" title="Supprimer">🗑</button></div>
  </div>`;
}

function openStartMaraude() {
  Modal.open("Démarrer une maraude", `
    <div class="field">
      <label>Secteur</label>
      <select id="m-secteur">${window.SECTEURS.map((s) => `<option>${s}</option>`).join("")}</select>
    </div>
    <div class="field">
      <label>Bénévoles (séparés par une virgule)</label>
      <input id="m-benevoles" placeholder="Alex, Sam, Nour" />
    </div>
    <button class="btn block" id="m-go">▶ Démarrer</button>`,
  (body) => {
    $("#m-go", body).onclick = () => {
      const active = {
        id: uid(), secteur: $("#m-secteur").value,
        benevoles: $("#m-benevoles").value.split(",").map((s) => s.trim()).filter(Boolean),
        debut: Date.now(),
      };
      DB.set("maraudeActive", active);
      Modal.close(); toast("Maraude démarrée"); updateActiveChip(); navigate("terrain");
    };
  });
}

function stopMaraude() {
  const active = DB.get("maraudeActive", null);
  if (!active) return;
  const nb = DB.get("rencontres", []).filter((r) => r.maraudeId === active.id).length;
  const done = { ...active, fin: Date.now(), nbRencontres: nb };
  const hist = DB.get("maraudes", []); hist.push(done); DB.set("maraudes", hist);
  DB.set("maraudeActive", null);
  toast(`Maraude clôturée · ${nb} rencontre(s)`); updateActiveChip(); navigate("terrain");
}

/* =========================================================================
   Tournée optimisée — ordonne les points (plus proche voisin) et propose
   la navigation étape par étape vers l'app maps du téléphone.
   ========================================================================= */
const R_TERRE = 6371000; // rayon Terre en mètres
function distanceM(a, b) {
  const toRad = (x) => x * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_TERRE * Math.asin(Math.sqrt(h));
}
/* Heuristique du plus proche voisin à partir d'un point de départ (GPS ou centre) */
function ordonnnerTournee(points, start) {
  const rest = points.slice();
  const order = []; let cur = start; const used = new Set();
  while (rest.some((p) => !used.has(p.id))) {
    let best = null, bestD = Infinity;
    rest.forEach((p) => { if (used.has(p.id)) return; const d = distanceM(cur, p); if (d < bestD) { bestD = d; best = p; } });
    if (!best) break;
    order.push(best); used.add(best.id); cur = best;
  }
  return order;
}

function openTourneeOptimisee(map, rencontres) {
  const pts = rencontres.filter((r) => r.lat && r.lng).map((r) => ({ id: r.id, lat: r.lat, lng: r.lng, lieu: r.lieu || "Rencontre", besoins: r.besoins || [], personneId: r.personneId }));
  if (pts.length < 2) return toast("Il faut au moins 2 points géolocalisés");

  Modal.open("🛣️ Tournée optimisée", `
    <p class="muted" style="font-size:13px;margin-top:4px">Itinéraire proposé (ordre optimisé). Position de départ :</p>
    <div class="field"><select id="tour-start">
      <option value="geo">📍 Ma position GPS actuelle</option>
      <option value="center">Centre de la carte</option>
    </select></div>
    <div id="tour-steps" style="margin:10px 0"></div>
    <p class="muted" style="font-size:12px">Astuce : « Naviguer » ouvre l'itinéraire dans l'app maps de ton téléphone (Google Maps / Apple Plans).</p>
    <button class="btn block" id="tour-go">🧭 Optimiser & afficher</button>`,
  (body) => {
    const render = (order, startPt) => {
      let cumKm = 0, prev = startPt;
      $("#tour-steps", body).innerHTML = order.map((p, i) => {
        const d = distanceM(prev, p) / 1000; cumKm += d; prev = p;
        const navUrl = `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}&travelmode=walking`;
        return `<div class="item" style="padding:10px 12px">
          <div class="item-ico"><b>${i + 1}</b></div>
          <div class="item-body">
            <div class="item-title">${esc(p.lieu)}</div>
            <div class="item-sub">${p.besoins.length ? p.besoins.join(", ") : ""}${p.besoins.length ? " · " : ""}+${d.toFixed(1)} km${i > 0 ? ` (total ${cumKm.toFixed(1)} km)` : ""}</div>
          </div>
          <div class="item-actions"><a class="icon-btn" href="${navUrl}" target="_blank" rel="noopener" title="Naviguer">🧭</a></div>
        </div>`;
      }).join("");
    };

    $("#tour-go", body).onclick = () => {
      const startVal = $("#tour-start", body).value;
      const proceed = (startPt) => {
        const order = ordonnnerTournee(pts, startPt);
        render(order, startPt);
        // Trace l'itinéraire sur la carte
        map.eachLayer((l) => { if (l instanceof L.Polyline) map.removeLayer(l); });
        const latlngs = [[startPt.lat, startPt.lng], ...order.map((p) => [p.lat, p.lng])];
        L.polyline(latlngs, { color: "#34d399", weight: 3, opacity: 0.7, dashArray: "6,8" }).addTo(map);
        order.forEach((p, i) => L.marker([p.lat, p.lng]).addTo(map).bindPopup(`<b>${i + 1}. ${esc(p.lieu)}</b>`));
        map.fitBounds(latlngs, { padding: [40, 40] });
        toast(`Tournée : ${order.length} étapes`);
      };
      if (startVal === "center") { const c = map.getCenter(); proceed({ lat: c.lat, lng: c.lng }); }
      else {
        if (!navigator.geolocation) return toast("GPS indisponible — utilise « centre de la carte »");
        toast("Localisation en cours…");
        navigator.geolocation.getCurrentPosition(
          (pos) => proceed({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
          () => toast("Position refusée — utilise « centre de la carte »"),
          { enableHighAccuracy: true, timeout: 8000 }
        );
      }
    };
  });
}

function openRencontreForm(latlng) {
  const active = DB.get("maraudeActive", null);
  if (!active) return toast("Démarre d'abord une maraude");
  const cold = isCold();
  Modal.open("Nouvelle rencontre", `
    ${cold ? `<div class="priority-hint">❄️ Grand Froid : besoins prioritaires pré-cochés.</div>` : ""}
    <div class="field"><label>Lieu / repère</label><input id="r-lieu" placeholder="Ex : sous le porche, station X" /></div>
    <div class="field"><label>Prénom (optionnel)</label><input id="r-prenom" placeholder="Respect de l'anonymat" /></div>
    <div class="field"><label>Rattacher à une personne suivie (optionnel)</label>
      <select id="r-personne">
        <option value="">— Aucune —</option>
        ${personOptions()}
        <option value="__new">＋ Créer une nouvelle fiche personne</option>
      </select>
    </div>
    <div class="field">
      <label>Besoins</label>
      <div class="chips-select" id="r-besoins">
        ${window.BESOIN_TYPES.map((b) => `<button type="button" class="chip-toggle ${cold && PRIORITE_FROID.includes(b) ? "on" : ""}" data-b="${b}">${b}</button>`).join("")}
      </div>
    </div>
    <div class="field"><label>Orientation proposée (optionnel)</label><input id="r-orient" placeholder="Ex : accueil de jour, 115" /></div>
    <div class="field"><label>Articles distribués (décrémente le stock)</label>
      <div id="r-distrib-list" class="list" style="margin-bottom:8px"></div>
      <div class="form-row" style="align-items:flex-end">
        <select id="r-distrib-sel" style="flex:2">${stockAvailable().map((s) => `<option value="${s.id}">${esc(stockLabel(s))}</option>`).join("") || `<option value="">Stock vide</option>`}</select>
        <input id="r-distrib-qte" type="number" min="1" value="1" style="flex:.7" />
        <button type="button" class="ghost-btn" id="r-distrib-add" title="Ajouter">＋</button>
      </div>
    </div>
    <div class="field"><label>Notes</label><textarea id="r-notes" placeholder="Situation, suivi à prévoir…"></textarea></div>
    <p class="muted" style="font-size:12px">🔒 Ne saisis que le nécessaire. Données stockées localement sur cet appareil.</p>
    <button class="btn block" id="r-save">Enregistrer</button>`,
  (body) => {
    const sel = new Set(cold ? PRIORITE_FROID : []);
    $all(".chip-toggle", body).forEach((c) => c.onclick = () => {
      c.classList.toggle("on"); c.classList.contains("on") ? sel.add(c.dataset.b) : sel.delete(c.dataset.b);
    });

    // Articles distribués
    const distribs = [];
    const drawDistribs = () => {
      $("#r-distrib-list", body).innerHTML = distribs.map((d, i) => `
        <div class="item" style="padding:8px 10px">
          <div class="item-ico">🎁</div>
          <div class="item-body"><div class="item-title" style="font-size:14px">${esc(d.nom)} ×${d.qte}</div></div>
          <button type="button" class="icon-btn" data-del-distrib="${i}">🗑</button>
        </div>`).join("");
      $all("[data-del-distrib]", body).forEach((b) => b.onclick = () => { distribs.splice(+b.dataset.delDistrib, 1); drawDistribs(); });
    };
    $("#r-distrib-add", body).onclick = () => {
      const id = $("#r-distrib-sel", body).value; if (!id) return toast("Stock vide");
      const it = stockAvailable().find((s) => s.id === id); if (!it) return;
      const qte = Math.min(+$("#r-distrib-qte", body).value || 1, it.qte);
      const ex = distribs.find((d) => d.stockId === id);
      if (ex) ex.qte += qte; else distribs.push({ stockId: id, nom: stockLabel(it).replace(/ \(reste.*$/, ""), qte });
      drawDistribs();
    };

    $("#r-save", body).onclick = () => {
      const persoSel = $("#r-personne").value;
      const rec = {
        id: uid(), maraudeId: active.id, date: Date.now(), benevole: profil().benevole || "",
        lieu: $("#r-lieu").value, prenom: $("#r-prenom").value,
        besoins: [...sel], orientation: $("#r-orient").value, notes: $("#r-notes").value,
        lat: latlng?.lat, lng: latlng?.lng,
      };
      if (persoSel && persoSel !== "__new") rec.personneId = persoSel;
      if (distribs.length) {
        const stock = DB.get("stock", []);
        distribs.forEach((d) => { const it = stock.find((s) => s.id === d.stockId); if (it) it.qte = Math.max(0, it.qte - d.qte); });
        DB.set("stock", stock);
        rec.distributions = distribs;
      }
      const list = DB.get("rencontres", []);
      list.push(rec);
      DB.set("rencontres", list);
      // Créer une fiche personne préremplie et la rattacher à cette rencontre
      if (persoSel === "__new") {
        openPersonForm(undefined, {
          prefill: { nom: rec.prenom, lieu: rec.lieu, lat: rec.lat, lng: rec.lng },
          onSaved: (np) => { linkRencontrePerson(rec.id, np.id); toast("Rencontre + fiche liées"); },
        });
        return;
      }
      Modal.close(); toast("Rencontre enregistrée"); navigate("terrain");
    };
  });
}

/* =========================================================================
   VUE 2 — STOCK
   ========================================================================= */
function renderStock(root) {
  const stock = notDeleted(DB.get("stock", []));
  const parDon = {};
  stock.forEach((s) => { if (s.donateur) { (parDon[s.donateur] ||= { lines: 0, units: 0 }); parDon[s.donateur].lines++; parDon[s.donateur].units += (s.qte || 0); } });
  const donors = Object.entries(parDon).sort((a, b) => b[1].lines - a[1].lines);

  root.innerHTML = `
    <div class="section-head">
      <h2>Inventaire embarqué</h2>
      <div style="display:flex;gap:8px">
        <button class="btn secondary small" id="dons-journal">📖 Journal des dons</button>
        <button class="btn small" id="add-stock">＋ Article</button>
      </div>
    </div>
    ${donors.length ? `<div class="card" style="margin-bottom:16px">
      <div class="section-head" style="margin:0 0 8px"><h2 style="font-size:15px">🎁 Dons par partenaire (stock actuel)</h2></div>
      ${donors.map(([nom, d]) => `<div style="display:flex;justify-content:space-between;gap:12px;padding:5px 0;font-size:14px;border-bottom:1px solid var(--border)">
        <span>${esc(nom)}</span><b style="white-space:nowrap">${d.lines} article(s) · ${d.units} u.</b></div>`).join("")}
    </div>` : ""}
    <div class="grid cards">
      ${stock.map(stockCard).join("") || `<div class="empty"><span class="big">📦</span>Stock vide.</div>`}
    </div>`;

  $("#add-stock").onclick = () => openStockForm();
  $("#dons-journal").onclick = openDonsJournal;
  $all("[data-edit-stock]").forEach((b) => b.onclick = () => openStockForm(DB.get("stock", []).find((x) => x.id === b.dataset.editStock)));
  $all("[data-inc]").forEach((b) => b.onclick = () => adjustStock(b.dataset.inc, +1));
  $all("[data-dec]").forEach((b) => b.onclick = () => adjustStock(b.dataset.dec, -1));
  $all("[data-del-stock]").forEach((b) => b.onclick = () => {
    delItem("stock", b.dataset.delStock);
    navigate("stock");
  });
}

function stockCard(s) {
  const pct = s.seuil > 0 ? Math.min(100, Math.round((s.qte / (s.seuil * 2)) * 100)) : 100;
  const cls = s.qte === 0 ? "out" : s.qte <= s.seuil ? "low" : "";
  return `<div class="card">
    <div style="display:flex;justify-content:space-between;align-items:start">
      <div>
        <div class="item-title">${esc(s.nom)}${s.taille ? ` <span class="chip" style="font-size:11px">T. ${esc(s.taille)}</span>` : ""}</div>
        <div class="item-sub">${esc(s.categorie)}${s.donateur ? ` · 🎁 Don de ${esc(s.donateur)}` : ""}</div>
      </div>
      <div style="display:flex;gap:2px">
        <button class="icon-btn" data-edit-stock="${s.id}" title="Modifier">✎</button>
        <button class="icon-btn" data-del-stock="${s.id}" title="Supprimer">🗑</button>
      </div>
    </div>
    <div class="stock-bar ${cls}"><span style="width:${pct}%"></span></div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px">
      <div class="qty">
        <button data-dec="${s.id}">−</button><span>${s.qte}</span><button data-inc="${s.id}">＋</button>
      </div>
      ${s.qte <= s.seuil ? `<span class="chip ${s.qte === 0 ? "chip-danger" : "chip-warn"}">${s.qte === 0 ? "Épuisé" : "Stock bas"}</span>` : `<span class="muted" style="font-size:12px">seuil ${s.seuil}</span>`}
    </div>
  </div>`;
}

function openDonsJournal() {
  const dons = getDons();
  const now = new Date();
  const moisDebut = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const parPart = {};
  dons.filter((d) => (d.date || 0) >= moisDebut).forEach((d) => {
    const k = d.partenaire || "—"; (parPart[k] ||= { n: 0, u: 0 }); parPart[k].n++; parPart[k].u += (d.qte || 0);
  });
  const recap = Object.entries(parPart).sort((a, b) => b[1].u - a[1].u);
  Modal.open("Journal des dons", `
    <button class="btn small block" id="don-add">＋ Enregistrer un don</button>
    <div class="section-head" style="margin:16px 0 8px"><h2 style="font-size:15px">🎁 Ce mois-ci</h2></div>
    ${recap.length ? recap.map(([p, v]) => `<div style="display:flex;justify-content:space-between;gap:12px;padding:5px 0;font-size:14px;border-bottom:1px solid var(--border)"><span>${esc(p)}</span><b style="white-space:nowrap">${v.n} don(s) · ${v.u} u.</b></div>`).join("") : `<p class="muted">Aucun don ce mois-ci.</p>`}
    <div class="section-head" style="margin:16px 0 8px"><h2 style="font-size:15px">Historique (${dons.length})</h2></div>
    <div class="list">${dons.length ? dons.map(donCard).join("") : `<div class="empty" style="padding:16px">Aucun don enregistré.</div>`}</div>`,
  (body) => {
    $("#don-add", body).onclick = () => openDonForm();
    $all("[data-del-don]", body).forEach((b) => b.onclick = () => { delItem("dons", b.dataset.delDon); openDonsJournal(); });
  });
}

function donCard(d) {
  return `<div class="item" style="padding:10px">
    <div class="item-ico">🎁</div>
    <div class="item-body">
      <div class="item-title" style="font-size:14px">${esc(d.partenaire || "Donateur")}</div>
      <div class="item-sub">${d.date ? fmtDate(d.date) : ""}${d.nom ? " · " + esc(d.nom) : ""}${d.qte ? " ×" + esc(d.qte) : ""}${d.categorie ? " · " + esc(d.categorie) : ""}</div>
    </div>
    <button class="icon-btn" data-del-don="${d.id}">🗑</button>
  </div>`;
}

function openDonForm() {
  Modal.open("Enregistrer un don", `
    <div class="field"><label>Date</label><input id="don-date" type="date" value="${new Date().toISOString().slice(0, 10)}" /></div>
    <div class="field"><label>Partenaire / donateur</label>
      <input id="don-part" list="don-part-list" placeholder="Ex : Boulangerie Martin" />
      <datalist id="don-part-list">${window.PARTENAIRES.map((pp) => `<option value="${esc(pp)}">`).join("")}</datalist>
    </div>
    <div class="field"><label>Article / nature du don</label><input id="don-nom" placeholder="Ex : sandwichs, couvertures…" /></div>
    <div class="form-row">
      <div class="field"><label>Quantité</label><input id="don-qte" type="number" min="0" value="1" /></div>
      <div class="field"><label>Catégorie</label><input id="don-cat" placeholder="Ex : Alimentaire" /></div>
    </div>
    <button class="btn block" id="don-save">Enregistrer</button>`,
  (body) => {
    $("#don-save", body).onclick = () => {
      const part = $("#don-part").value.trim(); if (!part) return toast("Indique le partenaire");
      const dv = $("#don-date").value;
      logDon({ id: uid(), date: dv ? new Date(dv).getTime() : Date.now(), partenaire: part, nom: $("#don-nom").value.trim(), qte: +$("#don-qte").value || 0, categorie: $("#don-cat").value.trim() });
      toast("Don enregistré"); openDonsJournal();
    };
  });
}

function adjustStock(id, delta) {
  const stock = DB.get("stock", []);
  const s = stock.find((x) => x.id === id); if (!s) return;
  s.qte = Math.max(0, s.qte + delta);
  DB.set("stock", stock); navigate("stock");
}

function openStockForm(existing) {
  const s = existing || {};
  Modal.open(existing ? "Modifier l'article" : "Nouvel article", `
    <div class="field"><label>Nom</label><input id="s-nom" value="${esc(s.nom || "")}" placeholder="Ex : Bonnets" /></div>
    <div class="form-row">
      <div class="field"><label>Catégorie</label><input id="s-cat" value="${esc(s.categorie || "")}" placeholder="Ex : Vêtements" /></div>
      <div class="field"><label>Taille (optionnel)</label>
        <input id="s-taille" list="taille-list" value="${esc(s.taille || "")}" placeholder="Ex : M, 42…" />
        <datalist id="taille-list">${window.TAILLES.map((t) => `<option value="${t}">`).join("")}</datalist>
      </div>
    </div>
    <div class="field"><label>Partenaire / donateur (optionnel)</label>
      <input id="s-donateur" list="partenaire-list" value="${esc(s.donateur || "")}" placeholder="Ex : Boulangerie Martin, Banque alimentaire…" />
      <datalist id="partenaire-list">${window.PARTENAIRES.map((pp) => `<option value="${esc(pp)}">`).join("")}</datalist>
    </div>
    <div class="form-row">
      <div class="field"><label>Quantité</label><input id="s-qte" type="number" value="${existing ? esc(s.qte) : 0}" min="0" /></div>
      <div class="field"><label>Seuil d'alerte</label><input id="s-seuil" type="number" value="${existing ? esc(s.seuil) : 5}" min="0" /></div>
    </div>
    <button class="btn block" id="s-save">${existing ? "Enregistrer" : "Ajouter"}</button>`,
  (body) => {
    $("#s-save", body).onclick = () => {
      const nom = $("#s-nom").value.trim(); if (!nom) return toast("Nom requis");
      const stock = DB.get("stock", []);
      const data = {
        nom, categorie: $("#s-cat").value || "Divers", taille: $("#s-taille").value.trim(),
        donateur: $("#s-donateur").value.trim(), qte: +$("#s-qte").value || 0, seuil: +$("#s-seuil").value || 0,
      };
      if (existing) {
        const it = stock.find((x) => x.id === existing.id);
        if (it) Object.assign(it, data);
      } else {
        stock.push({ id: uid(), ...data });
        if (data.donateur) logDon({ id: uid(), date: Date.now(), partenaire: data.donateur, nom: data.nom, qte: data.qte, categorie: data.categorie });
      }
      DB.set("stock", stock); Modal.close(); toast(existing ? "Article modifié" : "Article ajouté"); navigate("stock");
    };
  });
}

/* =========================================================================
   VUE 3 — COORDINATION (dashboard)
   ========================================================================= */
/* =========================================================================
   Graphiques canvas (zéro dépendance) — pour la vue Coordination
   ========================================================================= */
/* Palette issue du design system (lisible en clair comme en sombre) */
const CHART_COLORS = ["#38bdf8", "#34d399", "#fbbf24", "#f87171", "#a78bfa", "#fb923c"];

/* Lit une couleur CSS en RGB (utilisé pour les axes/textes adaptés au thème) */
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
/* Histogramme horizontal : libellés + valeurs. Canvas haute densité. */
function drawBarChart(canvas, data, opts) {
  opts = opts || {};
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth || 320, H = canvas.clientHeight || 180;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const ctx = canvas.getContext("2d"); ctx.scale(dpr, dpr); ctx.clearRect(0, 0, W, H);
  if (!data.length) { ctx.fillStyle = cssVar("--text-muted"); ctx.font = "13px system-ui"; ctx.fillText("Pas encore de données", 12, 24); return; }
  const max = Math.max(...data.map((d) => d.value), 1);
  const labelW = Math.min(110, Math.max(...data.map((d) => d.label.length)) * 6.5);
  const barH = Math.min(22, (H - 8) / data.length - 6), gap = 6, padTop = 6;
  const axisX = labelW + 8, plotW = W - axisX - 38;
  const ink = cssVar("--text-muted");
  data.forEach((d, i) => {
    const y = padTop + i * (barH + gap);
    ctx.fillStyle = ink; ctx.font = "12px system-ui"; ctx.textAlign = "right"; ctx.textBaseline = "middle";
    ctx.fillText(d.label.length > 16 ? d.label.slice(0, 15) + "…" : d.label, labelW, y + barH / 2);
    const w = Math.max(2, (d.value / max) * plotW);
    ctx.fillStyle = d.color || CHART_COLORS[i % CHART_COLORS.length];
    ctx.beginPath(); roundRect(ctx, axisX, y, w, barH, 4); ctx.fill();
    ctx.fillStyle = ink; ctx.textAlign = "left"; ctx.font = "600 12px system-ui";
    ctx.fillText(String(d.value), axisX + w + 6, y + barH / 2);
  });
}
/* Courbe : points [x, y] en valeur, dates pour l'axe X. */
function drawLineChart(canvas, data, opts) {
  opts = opts || {};
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth || 320, H = canvas.clientHeight || 160;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const ctx = canvas.getContext("2d"); ctx.scale(dpr, dpr); ctx.clearRect(0, 0, W, H);
  if (!data.length) { ctx.fillStyle = cssVar("--text-muted"); ctx.font = "13px system-ui"; ctx.fillText("Pas encore de données", 12, 24); return; }
  const padL = 30, padR = 12, padT = 12, padB = 22;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const maxY = Math.max(...data.map((d) => d.value), 1);
  const ink = cssVar("--text-muted"), primary = cssVar("--primary") || "#38bdf8";
  // grille horizontale (4 lignes)
  ctx.strokeStyle = ink + "33"; ctx.lineWidth = 1; ctx.font = "10px system-ui"; ctx.fillStyle = ink; ctx.textAlign = "right"; ctx.textBaseline = "middle";
  for (let i = 0; i <= 4; i++) {
    const y = padT + (plotH / 4) * i;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
    ctx.fillText(String(Math.round(maxY - (maxY / 4) * i)), padL - 4, y);
  }
  // courbe
  const step = data.length > 1 ? plotW / (data.length - 1) : 0;
  ctx.strokeStyle = primary; ctx.lineWidth = 2; ctx.beginPath();
  data.forEach((d, i) => {
    const x = padL + i * step, y = padT + plotH - (d.value / maxY) * plotH;
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });
  ctx.stroke();
  // points + labels d'axe (max 8)
  ctx.fillStyle = primary;
  const labelStep = Math.ceil(data.length / 7);
  data.forEach((d, i) => {
    const x = padL + i * step, y = padT + plotH - (d.value / maxY) * plotH;
    ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fill();
    if (i % labelStep === 0) { ctx.fillStyle = ink; ctx.font = "10px system-ui"; ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.fillText(d.label, x, H - padB + 4); ctx.fillStyle = primary; }
  });
}
/* Donut : parts + légende */
function drawDonut(canvas, data) {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth || 280, H = 180;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const ctx = canvas.getContext("2d"); ctx.scale(dpr, dpr); ctx.clearRect(0, 0, W, H);
  if (!data.length) { ctx.fillStyle = cssVar("--text-muted"); ctx.font = "13px system-ui"; ctx.fillText("Pas encore de données", 12, 24); return; }
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const cx = 70, cy = H / 2, R = 52, r = 30;
  let a = -Math.PI / 2;
  data.forEach((d, i) => {
    const slice = (d.value / total) * Math.PI * 2;
    ctx.fillStyle = d.color || CHART_COLORS[i % CHART_COLORS.length];
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R, a, a + slice); ctx.closePath(); ctx.fill();
    a += slice;
  });
  ctx.fillStyle = cssVar("--surface"); ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = cssVar("--text"); ctx.font = "700 16px system-ui"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(String(total), cx, cy);
  // légende
  ctx.textAlign = "left"; ctx.font = "12px system-ui";
  data.forEach((d, i) => {
    const y = 16 + i * 20;
    ctx.fillStyle = d.color || CHART_COLORS[i % CHART_COLORS.length];
    roundRect(ctx, 150, y - 6, 12, 12, 3); ctx.fill();
    ctx.fillStyle = cssVar("--text-muted");
    const pct = Math.round((d.value / total) * 100);
    ctx.fillText(`${d.label} (${pct}%)`, 168, y);
  });
}
/* Rectangle arrondi (utilitaire de tracé) */
function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

function renderCoordination(root) {
  const rencontres = notDeleted(DB.get("rencontres", []));
  const maraudes = notDeleted(DB.get("maraudes", []));
  const active = DB.get("maraudeActive", null);
  const stock = notDeleted(DB.get("stock", []));
  const stockBas = stock.filter((s) => s.qte <= s.seuil).length;

  const besoinCount = {};
  rencontres.forEach((r) => (r.besoins || []).forEach((b) => besoinCount[b] = (besoinCount[b] || 0) + 1));
  const topBesoins = Object.entries(besoinCount).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const maxB = topBesoins.length ? topBesoins[0][1] : 1;

  root.innerHTML = `
    ${isCold() ? `
      <div class="card" style="border-color:rgba(14,165,233,.5);margin-bottom:16px">
        <div class="section-head" style="margin:0 0 8px"><h2>❄️ Mobilisation express — Grand Froid</h2></div>
        <p class="muted" style="margin-top:0">Message prêt à envoyer aux bénévoles pour renforcer les tournées.</p>
        <button class="btn small" id="copy-mobilisation">📋 Copier le message d'appel</button>
      </div>` : ""}
    <div class="grid stats">
      ${statCard("🧭", maraudes.length + (active ? 1 : 0), "Maraudes")}
      ${statCard("📍", rencontres.length, "Rencontres")}
      ${statCard("⚠️", stockBas, "Articles en alerte")}
      ${statCard("🚨", notDeleted(DB.get("signalements", [])).filter((s) => s.statut !== "traité").length, "Signalements ouverts")}
    </div>

    <div style="margin-top:14px"><button class="btn secondary small" id="rapport-btn">📄 Rapport d'activité (PDF)</button></div>

    <div class="section-head" style="margin-top:22px">
      <h2>📅 Agenda & rappels</h2>
      <button class="btn secondary small" id="notif-btn">🔔 Activer les rappels</button>
    </div>
    <div class="list" id="agenda-list"></div>

    <div class="section-head" style="margin-top:22px">
      <h2>Planifier une maraude</h2>
      <button class="btn small" id="plan-maraude">＋ Planifier</button>
    </div>
    <div class="list" id="planned"></div>

    <div class="section-head" style="margin-top:22px"><h2>📊 Statistiques</h2></div>
    <div class="grid cards" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr))">
      <div class="card">
        <h3 style="font-size:14px;margin-bottom:8px">Rencontres sur 14 jours</h3>
        <canvas id="chart-renc" style="width:100%;height:160px"></canvas>
      </div>
      <div class="card">
        <h3 style="font-size:14px;margin-bottom:8px">Besoins les plus fréquents</h3>
        <canvas id="chart-besoins" style="width:100%;height:180px"></canvas>
      </div>
      <div class="card">
        <h3 style="font-size:14px;margin-bottom:8px">Personnes par situation</h3>
        <canvas id="chart-statut" style="width:100%;height:180px"></canvas>
      </div>
    </div>

    <div class="section-head" style="margin-top:22px"><h2>Besoins les plus fréquents</h2></div>
    <div class="card">
      ${topBesoins.length ? topBesoins.map(([b, n]) => `
        <div style="margin-bottom:10px">
          <div style="display:flex;justify-content:space-between;font-size:14px"><span>${esc(b)}</span><b>${n}</b></div>
          <div class="stock-bar"><span style="width:${Math.round((n / maxB) * 100)}%"></span></div>
        </div>`).join("") : `<p class="muted">Pas encore de données terrain.</p>`}
    </div>

    <div class="section-head" style="margin-top:22px">
      <h2>Historique</h2>
      <button class="btn secondary small" id="export">⬇ Export CSV</button>
    </div>
    <div class="list">
      ${maraudes.length ? maraudes.slice().reverse().map((m) => `
        <div class="item"><div class="item-ico">✅</div><div class="item-body">
          <div class="item-title">Secteur ${esc(m.secteur)} · ${m.nbRencontres} rencontre(s)</div>
          <div class="item-sub">${fmtDate(m.debut)} → ${m.fin ? fmtDate(m.fin) : "?"} · ${(m.benevoles || []).join(", ") || "—"}</div>
        </div></div>`).join("") : `<div class="empty">Aucune maraude clôturée.</div>`}
    </div>`;

  renderPlanned();
  renderAgenda();
  drawCoordinationCharts(rencontres);
  $("#plan-maraude").onclick = openPlanForm;
  $("#rapport-btn").onclick = openRapportForm;
  $("#notif-btn").onclick = enableNotifications;
  $("#export").onclick = exportCSV;
  if ($("#copy-mobilisation")) $("#copy-mobilisation").onclick = () => {
    const p = profil();
    const msg = `❄️ PLAN GRAND FROID — ${p.equipe || "Maraude"}\n`
      + `Renfort de tournées ce soir. Priorité : mise à l'abri (115), couvertures, boissons chaudes.\n`
      + `Bénévoles dispo, répondez ici. Merci 🤝`;
    navigator.clipboard?.writeText(msg).then(() => toast("Message copié"), () => toast("Copie impossible"));
  };
}

/* Dessine les 3 graphiques canvas de la vue Coordination */
function drawCoordinationCharts(rencontres) {
  // 1. Rencontres sur les 14 derniers jours (courbe)
  const days = 14;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const buckets = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86400000);
    const next = d.getTime() + 86400000;
    const count = rencontres.filter((r) => (r.date || 0) >= d.getTime() && (r.date || 0) < next).length;
    buckets.push({ label: d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }), value: count });
  }
  const cRenc = $("#chart-renc"); if (cRenc) drawLineChart(cRenc, buckets);

  // 2. Besoins les plus fréquents (barres horizontales)
  const bc = {};
  rencontres.forEach((r) => (r.besoins || []).forEach((b) => bc[b] = (bc[b] || 0) + 1));
  const besoinData = Object.entries(bc).sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([label, value]) => ({ label, value }));
  const cBes = $("#chart-besoins"); if (cBes) drawBarChart(cBes, besoinData);

  // 3. Personnes par situation (donut)
  const persos = getPersonnes();
  const parStatut = { "À la rue": 0, "Hébergé·e": 0, "Sorti·e": 0 };
  persos.forEach((p) => { if (p.statut === "sorti") parStatut["Sorti·e"]++; else if (p.statut === "hebergement") parStatut["Hébergé·e"]++; else parStatut["À la rue"]++; });
  const statutData = Object.entries(parStatut).filter(([, v]) => v > 0)
    .map(([label, value], i) => ({ label, value, color: ["#fbbf24", "#38bdf8", "#34d399"][i] }));
  const cStatut = $("#chart-statut"); if (cStatut) drawDonut(cStatut, statutData);
}

function renderPlanned() {
  const planned = notDeleted(DB.get("planned", []));
  const el = $("#planned"); if (!el) return;
  el.innerHTML = planned.length ? planned.map((p) => `
    <div class="item"><div class="item-ico">📅</div><div class="item-body">
      <div class="item-title">${esc(p.secteur)} · ${esc(p.date)} ${esc(p.heure)}</div>
      <div class="item-sub">${(p.benevoles || []).length} bénévole(s) : ${(p.benevoles || []).join(", ") || "à recruter"}</div>
    </div><div class="item-actions"><button class="icon-btn" data-del-plan="${p.id}">🗑</button></div></div>`).join("")
    : `<div class="empty" style="padding:20px">Aucune maraude planifiée.</div>`;
  $all("[data-del-plan]").forEach((b) => b.onclick = () => {
    delItem("planned", b.dataset.delPlan); renderPlanned();
  });
}

/* Agenda : maraudes planifiées + RDV démarches, triés par date */
function gatherAgenda() {
  const items = [];
  const startToday = new Date().setHours(0, 0, 0, 0);
  notDeleted(DB.get("planned", [])).forEach((p) => {
    if (!p.date || p.date === "à définir") return;
    const t = new Date(p.date + "T" + (p.heure || "00:00")).getTime();
    items.push({ date: t, type: "maraude", label: `Maraude — secteur ${p.secteur || "?"}`, sub: `${p.date} ${p.heure || ""}`, overdue: false });
  });
  getPersonnes().forEach((p) => (p.demarches || []).forEach((d) => {
    if (!d.echeance || d.statut === "done") return;
    const t = new Date(d.echeance).getTime();
    items.push({ date: t, type: "demarche", personId: p.id, label: `${d.libelle} — ${p.nom || "?"}`, sub: `RDV le ${d.echeance}`, overdue: t < startToday });
  }));
  return items.sort((a, b) => a.date - b.date);
}

function renderAgenda() {
  const el = $("#agenda-list"); if (!el) return;
  const items = gatherAgenda();
  el.innerHTML = items.length ? items.map((i) => `
    <div class="item" ${i.personId ? `data-agenda-person="${i.personId}" style="cursor:pointer"` : ""}>
      <div class="item-ico">${i.type === "maraude" ? "🧭" : "📋"}</div>
      <div class="item-body">
        <div class="item-title">${esc(i.label)}</div>
        <div class="item-sub">${esc(i.sub)}${i.overdue ? ` <span class="chip chip-danger">en retard</span>` : ""}</div>
      </div>
    </div>`).join("") : `<div class="empty" style="padding:16px">Rien de programmé. Ajoute des maraudes ou des RDV de démarches.</div>`;
  $all("[data-agenda-person]", el).forEach((b) => b.onclick = () => openPersonDetail(b.dataset.agendaPerson, "demarches"));
}

function enableNotifications() {
  if (!("Notification" in window)) return toast("Notifications non supportées ici");
  if (Notification.permission === "granted") { fireDueReminders(true); return; }
  Notification.requestPermission().then((perm) => {
    if (perm === "granted") { toast("Rappels activés 🔔"); fireDueReminders(true); }
    else toast("Rappels non autorisés");
  });
}

function fireDueReminders(force) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const soon = new Date().setHours(0, 0, 0, 0) + 86400000; // aujourd'hui + demain
  const due = gatherAgenda().filter((i) => i.date <= soon);
  if (!due.length) { if (force) toast("Aucun rappel imminent"); return; }
  const overdue = due.filter((i) => i.overdue).length;
  try {
    new Notification("Maraude — rappels", {
      body: `${due.length} échéance(s) proche(s)${overdue ? `, dont ${overdue} en retard` : ""}.`,
      tag: "maraude-reminders", icon: "manifest.json",
    });
  } catch { /* ignore */ }
}

function openPlanForm() {
  Modal.open("Planifier une maraude", `
    <div class="form-row">
      <div class="field"><label>Date</label><input id="p-date" type="date" /></div>
      <div class="field"><label>Heure</label><input id="p-heure" type="time" value="20:00" /></div>
    </div>
    <div class="field"><label>Secteur</label><select id="p-secteur">${window.SECTEURS.map((s) => `<option>${s}</option>`).join("")}</select></div>
    <div class="field"><label>Bénévoles</label><input id="p-benevoles" placeholder="Alex, Sam…" /></div>
    <button class="btn block" id="p-save">Planifier</button>`,
  (body) => {
    $("#p-save", body).onclick = () => {
      const planned = DB.get("planned", []);
      planned.push({
        id: uid(), date: $("#p-date").value || "à définir", heure: $("#p-heure").value,
        secteur: $("#p-secteur").value, benevoles: $("#p-benevoles").value.split(",").map((s) => s.trim()).filter(Boolean),
      });
      DB.set("planned", planned); Modal.close(); toast("Maraude planifiée"); navigate("coordination");
    };
  });
}

function exportCSV() {
  const rows = [["date", "secteur", "benevole", "lieu", "prenom", "besoins", "orientation", "notes"]];
  const maraudesById = {};
  DB.get("maraudes", []).forEach((m) => maraudesById[m.id] = m);
  const active = DB.get("maraudeActive", null); if (active) maraudesById[active.id] = active;
  notDeleted(DB.get("rencontres", [])).forEach((r) => rows.push([
    fmtDate(r.date), maraudesById[r.maraudeId]?.secteur || "", r.benevole || "", r.lieu || "", r.prenom || "",
    (r.besoins || []).join(" | "), r.orientation || "", (r.notes || "").replace(/\n/g, " "),
  ]));
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = "maraude-rencontres.csv"; a.click();
  toast("Export généré");
}

/* =========================================================================
   VUE 4 — SIGNALEMENTS (citoyen)
   ========================================================================= */
function renderSignalements(root) {
  const list = notDeleted(DB.get("signalements", []));
  // Rétro-compat : les anciens signalements sans champ `modere` sont considérés validés
  list.forEach((s) => { if (s.modere === undefined) s.modere = true; });
  const enAttente = list.filter((s) => !s.modere);
  const valides = list.filter((s) => s.modere);

  root.innerHTML = `
    <div class="card" style="text-align:center;margin-bottom:16px">
      <p class="muted" style="margin-top:0">Vous croisez une personne en difficulté ? Signalez-la à la maraude la plus proche.</p>
      <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
        <button class="btn" id="add-signal">🚨 Faire un signalement</button>
        <button class="btn secondary small" id="signal-qr">📱 QR d'accès</button>
      </div>
      <p class="muted" style="font-size:12px;margin-bottom:0">En cas de détresse vitale, appelez le <b>115</b> (ou le <b>15</b> / <b>112</b> si urgence médicale).</p>
    </div>
    ${enAttente.length ? `
      <div class="section-head"><h2>⏳ À modérer (${enAttente.length})</h2></div>
      <p class="muted" style="font-size:12px;margin-top:-8px">Ces signalements venant du public ne sont visibles des bénévoles qu'une fois vérifiés.</p>
      <div class="list" id="signal-pending">
        ${enAttente.slice().reverse().map(signalCard).join("")}
      </div>` : ""}
    <div id="map" style="margin:14px 0"></div>
    <div class="section-head"><h2>Signalements validés (${valides.length})</h2></div>
    <div class="list">
      ${valides.length ? valides.slice().reverse().map(signalCard).join("") : `<div class="empty"><span class="big">🚨</span>Aucun signalement validé.</div>`}
    </div>`;

  // La carte ne montre que les signalements validés (évite l'exposition de signalements non vérifiés)
  const map = initMap("map", [48.8606, 2.3776], 13);
  valides.forEach((s) => s.lat && L.marker([s.lat, s.lng]).addTo(map).bindPopup(esc(s.description)));
  $("#add-signal").onclick = () => openSignalForm(map);
  $("#signal-qr").onclick = () => showQR(location.origin + location.pathname, "QR — Signalement citoyen", "Scannez pour signaler une personne à la rue");

  // Modération : valider / rejeter les signalements en attente
  $all("[data-signal-approve]").forEach((b) => b.onclick = () => {
    const arr = DB.get("signalements", []);
    const s = arr.find((x) => x.id === b.dataset.signalApprove); if (!s) return;
    s.modere = true; s.statut = "ouvert"; s.updatedAt = Date.now();
    DB.set("signalements", arr); toast("Signalement validé ✓"); navigate("signalements");
  });
  $all("[data-signal-reject]").forEach((b) => b.onclick = () => {
    delItem("signalements", b.dataset.signalReject); toast("Signalement rejeté"); navigate("signalements");
  });
  // Changement de statut des validés
  $all("[data-signal-status]").forEach((b) => b.onclick = () => {
    const list = DB.get("signalements", []);
    const s = list.find((x) => x.id === b.dataset.signalStatus); if (!s) return;
    s.statut = s.statut === "ouvert" ? "pris en charge" : s.statut === "pris en charge" ? "traité" : "ouvert";
    DB.set("signalements", list); navigate("signalements");
  });
  $all("[data-del-signal]").forEach((b) => b.onclick = () => {
    delItem("signalements", b.dataset.delSignal); navigate("signalements");
  });
}

function signalCard(s) {
  const chip = s.statut === "traité" ? "chip-ok" : s.statut === "pris en charge" ? "chip-warn" : "chip-danger";
  const urg = { faible: "chip-muted", moyenne: "chip-warn", élevée: "chip-danger" }[s.urgence] || "chip-muted";
  // Carte différente selon que le signalement est en attente de modération ou validé
  if (!s.modere) {
    return `<div class="item" style="border-color:var(--warn);background:rgba(251,191,36,.05)">
      <div class="item-ico">🚨</div>
      <div class="item-body">
        <div class="item-title">${esc(s.description || "Signalement")}</div>
        <div class="item-sub">${fmtDate(s.date)}${s.lieu ? " · " + esc(s.lieu) : ""}</div>
        <div class="item-tags"><span class="chip ${urg}">Urgence ${esc(s.urgence)}</span></div>
        <div class="form-row" style="margin-top:10px">
          <button class="btn small" data-signal-approve="${s.id}">✓ Valider</button>
          <button class="btn danger small" data-signal-reject="${s.id}">✕ Rejeter</button>
        </div>
      </div>
    </div>`;
  }
  return `<div class="item">
    <div class="item-ico">🚨</div>
    <div class="item-body">
      <div class="item-title">${esc(s.description || "Signalement")}</div>
      <div class="item-sub">${fmtDate(s.date)}${s.lieu ? " · " + esc(s.lieu) : ""}</div>
      <div class="item-tags">
        <span class="chip ${urg}">Urgence ${esc(s.urgence)}</span>
        <button class="chip ${chip}" data-signal-status="${s.id}" style="cursor:pointer">${esc(s.statut)} ⟳</button>
      </div>
    </div>
    <div class="item-actions"><button class="icon-btn" data-del-signal="${s.id}">🗑</button></div>
  </div>`;
}

function openSignalForm(map) {
  const c = map ? map.getCenter() : { lat: 48.8606, lng: 2.3776 };
  Modal.open("Nouveau signalement", `
    <div class="field"><label>Description de la situation</label><textarea id="sg-desc" placeholder="Personne isolée, semble avoir froid…"></textarea></div>
    <div class="field"><label>Lieu / repère</label><input id="sg-lieu" placeholder="Adresse, station, repère" /></div>
    <div class="field">
      <label>Niveau d'urgence</label>
      <select id="sg-urg"><option value="faible">Faible</option><option value="moyenne" selected>Moyenne</option><option value="élevée">Élevée</option></select>
    </div>
    <div class="field"><label>Position (lat, lng)</label>
      <div class="form-row">
        <input id="sg-lat" value="${c.lat.toFixed(5)}" /><input id="sg-lng" value="${c.lng.toFixed(5)}" />
      </div>
      <button class="btn secondary small" id="sg-geo" style="margin-top:8px">📍 Me localiser</button>
    </div>
    <button class="btn block" id="sg-save">Envoyer le signalement</button>`,
  (body) => {
    $("#sg-geo", body).onclick = () => {
      if (!navigator.geolocation) return toast("Géolocalisation indisponible");
      navigator.geolocation.getCurrentPosition(
        (p) => { $("#sg-lat").value = p.coords.latitude.toFixed(5); $("#sg-lng").value = p.coords.longitude.toFixed(5); toast("Position récupérée"); },
        () => toast("Position refusée"));
    };
    $("#sg-save", body).onclick = () => {
      const desc = $("#sg-desc").value.trim(); if (!desc) return toast("Décris la situation");
      const list = DB.get("signalements", []);
      list.push({
        id: uid(), date: Date.now(), description: desc, lieu: $("#sg-lieu").value,
        urgence: $("#sg-urg").value, statut: "ouvert", modere: false,
        lat: parseFloat($("#sg-lat").value), lng: parseFloat($("#sg-lng").value),
      });
      DB.set("signalements", list); Modal.close(); toast("Signalement transmis — il sera vérifié par un coordinateur"); navigate("signalements");
    };
  });
}

/* =========================================================================
   VUE 5 — RESSOURCES (annuaire)
   ========================================================================= */
function renderRessources(root) {
  const all = notDeleted(DB.get("ressources", []));
  root.innerHTML = `
    <div class="section-head">
      <div class="chips-select" id="res-filter">
        <button class="chip-toggle on" data-f="all">Tout</button>
        ${window.RESSOURCE_TYPES.map((t) => `<button class="chip-toggle" data-f="${t}">${t}</button>`).join("")}
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn secondary small" id="import-res">⬇ Importer</button>
        <button class="btn small" id="add-res">＋ Ressource</button>
      </div>
    </div>
    <input type="file" id="res-file" accept=".json,.csv,application/json,text/csv" class="hidden" />
    <div id="map" style="margin:14px 0"></div>
    <div class="list" id="res-list"></div>`;

  const map = initMap("map", [48.8606, 2.3776], 13);
  let filter = "all";
  const draw = () => {
    const list = filter === "all" ? all : all.filter((r) => r.type === filter);
    $("#res-list").innerHTML = list.map(resCard).join("") || `<div class="empty">Aucune ressource.</div>`;
    map.eachLayer((l) => { if (l instanceof L.Marker) map.removeLayer(l); });
    list.forEach((r) => r.lat && L.marker([r.lat, r.lng]).addTo(map)
      .bindPopup(`<b>${esc(r.nom)}</b><br>${esc(r.type)}<br>${esc(r.horaires || "")}`));
    $all("[data-del-res]").forEach((b) => b.onclick = () => {
      delItem("ressources", b.dataset.delRes); navigate("ressources");
    });
  };
  draw();
  $all("#res-filter .chip-toggle").forEach((c) => c.onclick = () => {
    $all("#res-filter .chip-toggle").forEach((x) => x.classList.remove("on"));
    c.classList.add("on"); filter = c.dataset.f; draw();
  });
  $("#add-res").onclick = openResForm;
  $("#import-res").onclick = () => $("#res-file").click();
  $("#res-file").onchange = (e) => importRessources(e.target.files[0]);
}

/* Import annuaire : accepte JSON (tableau) ou CSV (nom,type,adresse,horaires,tel,lat,lng) */
function importRessources(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    let items = [];
    const txt = reader.result;
    try {
      if (file.name.toLowerCase().endsWith(".json")) {
        const parsed = JSON.parse(txt);
        items = Array.isArray(parsed) ? parsed : (parsed.ressources || []);
      } else {
        items = parseCSV(txt);
      }
    } catch { return toast("Import impossible"); }
    if (!items.length) return toast("Aucune ressource trouvée");
    const list = DB.get("ressources", []);
    const byId = {}; list.forEach((x) => byId[x.id] = x);
    let n = 0;
    items.forEach((it) => {
      if (!it.nom) return;
      const id = it.id || uid();
      byId[id] = {
        id, nom: it.nom, type: it.type || "Autre", adresse: it.adresse || "",
        horaires: it.horaires || "", tel: it.tel || "",
        lat: parseFloat(it.lat) || null, lng: parseFloat(it.lng) || null,
      };
      n++;
    });
    DB.set("ressources", Object.values(byId));
    toast(`${n} ressource(s) importée(s)`); navigate("ressources");
  };
  reader.readAsText(file);
}

function parseCSV(txt) {
  const lines = txt.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const head = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/^"|"$/g, ""));
  return lines.slice(1).map((line) => {
    const vals = line.split(",").map((c) => c.trim().replace(/^"|"$/g, "").replace(/""/g, '"'));
    const o = {}; head.forEach((h, i) => o[h] = vals[i]); return o;
  });
}

function resCard(r) {
  const ico = { "Douches": "🚿", "Repas": "🍲", "Hébergement": "🛏️", "Santé": "⚕️", "Point d'eau": "💧", "Bagagerie": "🎒", "Accueil de jour": "🏠" }[r.type] || "📌";
  return `<div class="item">
    <div class="item-ico">${ico}</div>
    <div class="item-body">
      <div class="item-title">${esc(r.nom)}</div>
      <div class="item-sub">${esc(r.adresse || "")}</div>
      <div class="item-tags">
        <span class="chip">${esc(r.type)}</span>
        ${r.horaires ? `<span class="chip chip-muted">🕐 ${esc(r.horaires)}</span>` : ""}
        ${r.tel ? `<a class="chip chip-ok" href="tel:${esc(r.tel)}">📞 ${esc(r.tel)}</a>` : ""}
      </div>
    </div>
    <div class="item-actions"><button class="icon-btn" data-del-res="${r.id}">🗑</button></div>
  </div>`;
}

function openResForm() {
  Modal.open("Nouvelle ressource", `
    <div class="field"><label>Nom</label><input id="re-nom" /></div>
    <div class="field"><label>Type</label><select id="re-type">${window.RESSOURCE_TYPES.map((t) => `<option>${t}</option>`).join("")}</select></div>
    <div class="field"><label>Adresse</label><input id="re-adr" /></div>
    <div class="field"><label>Horaires</label><input id="re-hor" placeholder="Lun–Ven 9h–17h" /></div>
    <div class="field"><label>Téléphone</label><input id="re-tel" /></div>
    <div class="form-row">
      <div class="field"><label>Latitude</label><input id="re-lat" value="48.8606" /></div>
      <div class="field"><label>Longitude</label><input id="re-lng" value="2.3776" /></div>
    </div>
    <button class="btn block" id="re-save">Ajouter</button>`,
  (body) => {
    $("#re-save", body).onclick = () => {
      const nom = $("#re-nom").value.trim(); if (!nom) return toast("Nom requis");
      const list = DB.get("ressources", []);
      list.push({
        id: uid(), nom, type: $("#re-type").value, adresse: $("#re-adr").value,
        horaires: $("#re-hor").value, tel: $("#re-tel").value,
        lat: parseFloat($("#re-lat").value), lng: parseFloat($("#re-lng").value),
      });
      DB.set("ressources", list); Modal.close(); toast("Ressource ajoutée"); navigate("ressources");
    };
  });
}

/* =========================================================================
   VUE 6 — PERSONNES À LA RUE (fiches + articles + démarches + cagnotte)
   ========================================================================= */
function getPersonnes() { return notDeleted(DB.get("personnes", [])); }
function getPerson(id) { return DB.get("personnes", []).find((p) => p.id === id); }
function upsertPerson(p) {
  const list = DB.get("personnes", []);
  const i = list.findIndex((x) => x.id === p.id);
  if (i >= 0) list[i] = p; else list.push(p);
  DB.set("personnes", list);
}
function personName(id) { const p = getPerson(id); return p ? p.nom : "fiche"; }
/* Construit une URL de profil quand c'est possible, sinon null */
function socialUrl(reseau, pseudo) {
  const h = (pseudo || "").trim().replace(/^@/, "");
  if (!h) return null;
  switch (reseau) {
    case "TikTok": return "https://www.tiktok.com/@" + encodeURIComponent(h);
    case "Instagram": return "https://instagram.com/" + encodeURIComponent(h);
    case "X (Twitter)": return "https://x.com/" + encodeURIComponent(h);
    case "Facebook": return "https://facebook.com/" + encodeURIComponent(h);
    case "YouTube": return "https://youtube.com/@" + encodeURIComponent(h);
    default: return null; // Snapchat, WhatsApp, Autre : pas d'URL fiable
  }
}
function socialIcon(reseau) {
  return { TikTok: "🎵", Instagram: "📸", Facebook: "👍", Snapchat: "👻", "X (Twitter)": "𝕏", WhatsApp: "💬", YouTube: "▶️" }[reseau] || "🔗";
}
function personOptions(selectedId) {
  return getPersonnes().map((p) => `<option value="${p.id}" ${p.id === selectedId ? "selected" : ""}>${esc(p.nom)}</option>`).join("");
}
function linkRencontrePerson(rencontreId, personId) {
  const list = DB.get("rencontres", []);
  const r = list.find((x) => x.id === rencontreId);
  if (r) { r.personneId = personId; DB.set("rencontres", list); }
}
function rencontresForPerson(id) {
  return notDeleted(DB.get("rencontres", [])).filter((r) => r.personneId === id).sort((a, b) => b.date - a.date);
}
const SEEN_ALERT_DAYS = 14;
function personStats(id) {
  const rencs = rencontresForPerson(id);
  const lastDate = rencs.length ? rencs[0].date : null;
  const daysSince = lastDate != null ? Math.floor((Date.now() - lastDate) / 86400000) : null;
  return { count: rencs.length, lastDate, daysSince, alert: daysSince != null && daysSince > SEEN_ALERT_DAYS };
}
function statutChip(statut) {
  const map = { rue: ["chip-warn", "🏚️ À la rue"], hebergement: ["chip", "🏠 Hébergé·e"], sorti: ["chip-ok", "✅ Sorti·e de rue"] };
  const [cls, lbl] = map[statut] || map.rue;
  return `<span class="chip ${cls}">${lbl}</span>`;
}
function demarcheOverdue(d) { return d.echeance && d.statut !== "done" && new Date(d.echeance).getTime() < new Date().setHours(0, 0, 0, 0); }
function hasRappel(p) {
  const soon = Date.now() + 3 * 86400000;
  return (p.demarches || []).some((d) => d.echeance && d.statut !== "done" && new Date(d.echeance).getTime() <= soon);
}
function seenLabel(daysSince) {
  if (daysSince == null) return "jamais vu·e";
  if (daysSince === 0) return "vu·e aujourd'hui";
  if (daysSince === 1) return "vu·e hier";
  return "vu·e il y a " + daysSince + " j";
}

function personMatches(p, term, filter) {
  if (term) {
    const t = term.toLowerCase();
    const inReseaux = (p.reseaux || []).some((r) => (r.pseudo || "").toLowerCase().includes(t));
    if (!((p.nom || "").toLowerCase().includes(t) || (p.lieu || "").toLowerCase().includes(t) || (p.adresse || "").toLowerCase().includes(t) || inReseaux)) return false;
  }
  if (filter === "afournir") return (p.articles || []).some((a) => !a.fourni);
  if (filter === "demarche") return (p.demarches || []).some((d) => d.statut !== "done");
  if (filter === "cagnotte") return p.cagnotte && p.cagnotte.active;
  if (filter === "pasvu") return personStats(p.id).alert;
  if (filter === "rappel") return hasRappel(p);
  return true;
}

function renderPersonnes(root) {
  const all = getPersonnes();
  root.innerHTML = `
    <div class="section-head">
      <h2>Personnes suivies (${all.length})</h2>
      <div style="display:flex;gap:8px">
        ${all.length >= 2 ? `<button class="btn secondary small" id="duplicates-btn">🔀 Doublons</button>` : ""}
        <button class="btn small" id="add-person">＋ Personne</button>
      </div>
    </div>
    <p class="muted" style="font-size:12px;margin-top:-6px">🔒 Données sensibles. Prénom/surnom suffit — n'inscris que le nécessaire, avec l'accord de la personne quand c'est possible.</p>
    <div class="field" style="margin-bottom:10px"><input id="person-search" placeholder="🔎 Rechercher (nom, lieu)…" /></div>
    <div class="chips-select" id="person-filter" style="margin-bottom:12px">
      <button class="chip-toggle on" data-f="all">Tout</button>
      <button class="chip-toggle" data-f="afournir">🎒 Articles à fournir</button>
      <button class="chip-toggle" data-f="demarche">📋 Démarches en cours</button>
      <button class="chip-toggle" data-f="cagnotte">💶 Cagnotte active</button>
      <button class="chip-toggle" data-f="pasvu">👁 Pas vu·e récemment</button>
      <button class="chip-toggle" data-f="rappel">⏰ RDV à venir</button>
    </div>
    <div id="map" style="margin:14px 0"></div>
    <div class="list" id="person-list"></div>`;

  const map = initMap("map", [48.8606, 2.3776], 13);
  let term = "", filter = "all";

  const draw = () => {
    const list = all.filter((p) => personMatches(p, term, filter));
    $("#person-list").innerHTML = list.length
      ? list.slice().reverse().map(personCard).join("")
      : `<div class="empty"><span class="big">🧑</span>${all.length ? "Aucune personne ne correspond." : "Aucune personne enregistrée."}</div>`;
    $all("[data-person]").forEach((el) => el.onclick = () => openPersonDetail(el.dataset.person));

    if (map.eachLayer) {
      map.eachLayer((l) => { if (l instanceof L.Marker) map.removeLayer(l); });
      const withGeo = list.filter((p) => p.lat && p.lng);
      withGeo.forEach((p) => {
        L.marker([p.lat, p.lng]).addTo(map)
          .bindTooltip(p.nom || "?")
          .bindPopup(`<b>${esc(p.nom || "?")}</b>${(p.adresse || p.lieu) ? "<br>" + esc(p.adresse || p.lieu) : ""}`)
          .on("click", () => openPersonDetail(p.id));
      });
      if (withGeo.length && map.fitBounds) {
        try { map.fitBounds(withGeo.map((p) => [p.lat, p.lng]), { padding: [40, 40], maxZoom: 15 }); } catch {}
      }
    }
  };

  $("#person-search").oninput = (e) => { term = e.target.value.trim(); draw(); };
  $all("#person-filter .chip-toggle").forEach((c) => c.onclick = () => {
    $all("#person-filter .chip-toggle").forEach((x) => x.classList.remove("on"));
    c.classList.add("on"); filter = c.dataset.f; draw();
  });
  $("#add-person").onclick = () => openPersonForm();
  if ($("#duplicates-btn")) $("#duplicates-btn").onclick = openDuplicatesReview;
  draw();
}

/* =========================================================================
   Détection de doublons — score de similarité entre fiches personnes.
   Critères : nom proche, même lieu/adresse, position GPS proche (< 80 m).
   ========================================================================= */
function normalize(s) { return String(s || "").toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }
function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  const prev = new Array(n + 1), cur = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] : 1 + Math.min(prev[j - 1], prev[j], cur[j - 1]);
    for (let j = 0; j <= n; j++) prev[j] = cur[j];
  }
  return prev[n];
}
/* Score 0..1 : 1 = très probablement le même personne */
function personSimilarity(a, b) {
  let score = 0;
  const na = normalize(a.nom), nb = normalize(b.nom);
  if (na && nb) {
    const d = levenshtein(na, nb);
    const sim = 1 - d / Math.max(na.length, nb.length);
    if (sim >= 0.85 && sim < 1) score += 0.6;       // nom quasi identique (faute de frappe)
    else if (sim === 1) score += 0.8;               // nom identique
    else if (sim >= 0.6) score += 0.35;             // nom ressemblant
  }
  const la = normalize(a.lieu || a.adresse), lb = normalize(b.lieu || b.adresse);
  if (la && lb && (la.includes(lb) || lb.includes(la) || levenshtein(la, lb) <= 2)) score += 0.25;
  if (a.lat && a.lng && b.lat && b.lng && distanceM(a, b) < 80) score += 0.3;
  if (a.age && b.age && a.age === b.age) score += 0.05;
  return Math.min(1, score);
}
function findDuplicates() {
  const all = getPersonnes();
  const pairs = [];
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    const sc = personSimilarity(all[i], all[j]);
    if (sc >= 0.55) pairs.push({ a: all[i], b: all[j], score: sc });
  }
  return pairs.sort((x, y) => y.score - x.score);
}
function openDuplicatesReview() {
  const pairs = findDuplicates();
  Modal.open("🔀 Doublons potentiels", `
    <p class="muted" style="font-size:13px;margin-top:4px">Fiches qui semblent désigner la même personne (nom/lieu/GPS proches). Tu peux les <b>fusionner</b> — les rencontres, articles et démarches sont conservés.</p>
    <div id="dup-list" style="margin-top:12px"></div>`,
  (body) => {
    if (!pairs.length) { $("#dup-list", body).innerHTML = `<div class="empty" style="padding:24px">Aucun doublon détecté 👍</div>`; return; }
    const render = () => {
      $("#dup-list", body).innerHTML = pairs.map((p, i) => `
        <div class="card" style="margin-bottom:12px;padding:12px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <span class="chip ${p.score >= 0.8 ? "chip-danger" : "chip-warn"}">${Math.round(p.score * 100)}% similaire</span>
          </div>
          <div class="item" style="border:none;padding:6px 0">
            <div class="avatar">${esc((p.a.nom || "?").slice(0, 2).toUpperCase())}</div>
            <div class="item-body"><div class="item-title">${esc(p.a.nom)}</div><div class="item-sub">${esc(p.a.adresse || p.a.lieu || "—")}</div></div>
          </div>
          <div class="item" style="border:none;padding:6px 0">
            <div class="avatar">${esc((p.b.nom || "?").slice(0, 2).toUpperCase())}</div>
            <div class="item-body"><div class="item-title">${esc(p.b.nom)}</div><div class="item-sub">${esc(p.b.adresse || p.b.lieu || "—")}</div></div>
          </div>
          <div class="form-row" style="margin-top:10px">
            <button class="btn secondary small" data-dup-keep="a" data-i="${i}">Garder « ${esc(p.a.nom)} »</button>
            <button class="btn secondary small" data-dup-keep="b" data-i="${i}">Garder « ${esc(p.b.nom)} »</button>
          </div>
          <button class="btn small block" data-dup-skip="${i}" style="margin-top:6px;background:transparent;color:var(--text-muted)">Pas un doublon</button>
        </div>`).join("");
      $all("[data-dup-keep]", body).forEach((b) => b.onclick = () => {
        const i = +b.dataset.i; const pair = pairs[i];
        const keep = b.dataset.dupKeep === "a" ? pair.a : pair.b;
        const drop = b.dataset.dupKeep === "a" ? pair.b : pair.a;
        mergePersons(keep.id, drop.id);
        toast(`Fusionné dans « ${keep.nom} »`);
        pairs.splice(i, 1); render();
      });
      $all("[data-dup-skip]", body).forEach((b) => b.onclick = () => { pairs.splice(+b.dataset.dupSkip, 1); render(); });
    };
    render();
  });
}
/* Fusionne `dropId` dans `keepId` : relocalise les rencontres, concatène articles/démarches, supprime drop. */
function mergePersons(keepId, dropId) {
  const list = DB.get("personnes", []);
  const keep = list.find((p) => p.id === keepId), drop = list.find((p) => p.id === dropId);
  if (!keep || !drop) return;
  keep.articles = [...(keep.articles || []), ...(drop.articles || [])];
  keep.demarches = [...(keep.demarches || []), ...(drop.demarches || [])];
  if (!keep.notes && drop.notes) keep.notes = drop.notes;
  if (!keep.tel && drop.tel) keep.tel = drop.tel;
  if (!keep.adresse && drop.adresse) keep.adresse = drop.adresse;
  if (!keep.lat && drop.lat) { keep.lat = drop.lat; keep.lng = drop.lng; }
  DB.set("personnes", list);
  // Rebloque les rencontres vers la fiche conservée
  const rencs = DB.get("rencontres", []);
  rencs.forEach((r) => { if (r.personneId === dropId) r.personneId = keepId; });
  DB.set("rencontres", rencs);
  // Supprime la fiche en doublon
  delItem("personnes", dropId);
}

function personCard(p) {
  const articles = p.articles || [], demarches = p.demarches || [];
  const aFournir = articles.filter((a) => !a.fourni).length;
  const dEnCours = demarches.filter((d) => d.statut !== "done").length;
  const cag = p.cagnotte;
  const pct = cag && cag.objectif > 0 ? Math.min(100, Math.round((cag.collecte / cag.objectif) * 100)) : 0;
  const st = personStats(p.id);
  const seenChip = st.count ? `<span class="chip ${st.alert ? "chip-warn" : "chip-muted"}">👁 ${seenLabel(st.daysSince)}</span>` : "";
  return `<div class="card item person-card" data-person="${p.id}">
    <div class="avatar">${esc((p.nom || "?").trim().charAt(0).toUpperCase() || "?")}</div>
    <div class="item-body">
      <div class="item-title">${esc(p.nom || "Sans nom")}${p.age ? ` · ${esc(p.age)} ans` : ""}</div>
      <div class="item-sub">${p.adresse ? "🏠 " + esc(p.adresse) : (p.lieu ? "📍 " + esc(p.lieu) : "Lieu non précisé")}</div>
      <div class="person-meta">
        ${statutChip(p.statut)}
        ${hasRappel(p) ? `<span class="chip chip-warn">⏰ RDV démarche</span>` : ""}
        ${seenChip}
        ${p.animaux ? `<span class="chip">🐾 ${esc(p.animaux)}</span>` : ""}
        ${aFournir ? `<span class="chip chip-warn">🎒 ${aFournir} à fournir</span>` : (articles.length ? `<span class="chip chip-ok">🎒 à jour</span>` : "")}
        ${dEnCours ? `<span class="chip">📋 ${dEnCours} démarche(s)</span>` : ""}
        ${cag && cag.active ? `<span class="chip chip-ok">💶 ${pct}%</span>` : ""}
      </div>
    </div>
  </div>`;
}

/* Reverse-geocoding : coordonnées -> adresse lisible (OpenStreetMap / Nominatim) */
async function reverseGeocode(lat, lng) {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`;
  const res = await fetch(url, { headers: { "Accept-Language": "fr" } });
  if (!res.ok) throw new Error("geocode " + res.status);
  const j = await res.json();
  return j.display_name || null;
}

/* Géolocalise l'appareil puis remplit adresse + lat/lng automatiquement */
function autoLocatePerson(body) {
  if (!navigator.geolocation) return toast("Géolocalisation indisponible");
  const btn = $("#p-geo", body);
  const prev = btn.textContent; btn.textContent = "⏳ Localisation…"; btn.disabled = true;
  navigator.geolocation.getCurrentPosition(async (pos) => {
    const lat = pos.coords.latitude, lng = pos.coords.longitude;
    $("#p-lat", body).value = lat.toFixed(6);
    $("#p-lng", body).value = lng.toFixed(6);
    try {
      const adr = await reverseGeocode(lat, lng);
      if (adr) { $("#p-adresse", body).value = adr; toast("Adresse trouvée automatiquement"); }
      else toast("Position OK (adresse introuvable)");
    } catch {
      toast("Position enregistrée (adresse hors-ligne)");
    } finally { btn.textContent = prev; btn.disabled = false; }
  }, () => {
    toast("Localisation refusée"); btn.textContent = prev; btn.disabled = false;
  }, { enableHighAccuracy: true, timeout: 10000 });
}

function openPersonForm(existing, opts) {
  opts = opts || {};
  const p = existing || opts.prefill || {};
  Modal.open(existing ? "Modifier la fiche" : "Nouvelle personne", `
    <div class="field"><label>Nom / surnom</label><input id="p-nom" value="${esc(p.nom || "")}" placeholder="Prénom, surnom" /></div>
    <div class="field"><label>Situation</label>
      <select id="p-statut">
        <option value="rue" ${(!p.statut || p.statut === "rue") ? "selected" : ""}>À la rue</option>
        <option value="hebergement" ${p.statut === "hebergement" ? "selected" : ""}>Hébergement temporaire</option>
        <option value="sorti" ${p.statut === "sorti" ? "selected" : ""}>Sorti·e de la rue</option>
      </select>
    </div>
    <div class="form-row">
      <div class="field"><label>Âge (approx.)</label><input id="p-age" type="number" min="0" value="${esc(p.age || "")}" /></div>
      <div class="field"><label>Animaux</label><input id="p-animaux" value="${esc(p.animaux || "")}" placeholder="Ex : chien Rex" /></div>
    </div>
    <div class="form-row">
      <div class="field"><label>Téléphone</label><input id="p-tel" type="tel" value="${esc(p.tel || "")}" placeholder="Optionnel" /></div>
      <div class="field"><label>Email</label><input id="p-email" type="email" value="${esc(p.email || "")}" placeholder="Optionnel" /></div>
    </div>
    <div class="field"><label>Réseaux sociaux (TikTok, Insta…)</label>
      <div id="p-reseaux-list" class="list" style="margin-bottom:8px"></div>
      <div class="form-row" style="align-items:flex-end">
        <select id="p-res-type" style="flex:1">${window.RESEAUX_TYPES.map((r) => `<option>${r}</option>`).join("")}</select>
        <input id="p-res-pseudo" style="flex:1.2" placeholder="@pseudo" />
        <button type="button" class="ghost-btn" id="p-res-add" title="Ajouter">＋</button>
      </div>
    </div>
    <div class="field"><label>Adresse où elle dort / où la trouver</label>
      <input id="p-adresse" value="${esc(p.adresse || "")}" placeholder="Remplie automatiquement via 📍" />
      <button type="button" class="btn secondary small" id="p-geo" style="margin-top:8px">📍 Localiser automatiquement</button>
    </div>
    <div class="field"><label>Repère / précision (optionnel)</label><input id="p-lieu" value="${esc(p.lieu || "")}" placeholder="Ex : sous le pont Y, 3ᵉ banc" /></div>
    <div class="form-row">
      <div class="field"><label>Latitude</label><input id="p-lat" value="${esc(p.lat || "")}" /></div>
      <div class="field"><label>Longitude</label><input id="p-lng" value="${esc(p.lng || "")}" /></div>
    </div>
    <div class="field"><label>Notes (situation, habitudes…)</label><textarea id="p-notes" placeholder="Ne pas inscrire de données médicales sensibles">${esc(p.notes || "")}</textarea></div>
    <button class="btn block" id="p-save">${existing ? "Enregistrer" : "Créer la fiche"}</button>`,
  (body) => {
    $("#p-geo", body).onclick = () => autoLocatePerson(body);

    // Réseaux sociaux
    let reseaux = (p.reseaux || []).map((r) => ({ ...r }));
    const drawReseaux = () => {
      $("#p-reseaux-list", body).innerHTML = reseaux.length ? reseaux.map((r, i) => `
        <div class="item" style="padding:8px 10px">
          <div class="item-ico">${socialIcon(r.reseau)}</div>
          <div class="item-body"><div class="item-title" style="font-size:14px">${esc(r.reseau)} · ${esc(r.pseudo)}</div></div>
          <button type="button" class="icon-btn" data-del-res-i="${i}">🗑</button>
        </div>`).join("") : "";
      $all("[data-del-res-i]", body).forEach((b) => b.onclick = () => { reseaux.splice(+b.dataset.delResI, 1); drawReseaux(); });
    };
    drawReseaux();
    $("#p-res-add", body).onclick = () => {
      const pseudo = $("#p-res-pseudo", body).value.trim();
      if (!pseudo) return toast("Indique le pseudo");
      reseaux.push({ reseau: $("#p-res-type", body).value, pseudo });
      $("#p-res-pseudo", body).value = ""; drawReseaux();
    };

    $("#p-save", body).onclick = () => {
      const nom = $("#p-nom").value.trim();
      if (!nom) return toast("Indique au moins un nom/surnom");
      const person = existing ? { ...existing } : { id: uid(), createdAt: Date.now(), articles: [], demarches: [], cagnotte: null };
      person.nom = nom;
      person.statut = $("#p-statut").value;
      person.age = $("#p-age").value;
      person.animaux = $("#p-animaux").value.trim();
      person.tel = $("#p-tel").value.trim();
      person.email = $("#p-email").value.trim();
      person.reseaux = reseaux;
      person.adresse = $("#p-adresse").value.trim();
      person.lieu = $("#p-lieu").value.trim();
      person.lat = parseFloat($("#p-lat").value) || null;
      person.lng = parseFloat($("#p-lng").value) || null;
      person.notes = $("#p-notes").value;
      upsertPerson(person);
      toast(existing ? "Fiche mise à jour" : "Fiche créée");
      if (existing) { openPersonDetail(person.id); return; }
      Modal.close();
      if (opts.onSaved) opts.onSaved(person);
      navigate(currentView);
    };
  });
}

function openPersonDetail(id, tab) {
  const p = getPerson(id);
  if (!p) return;
  const active = tab || "infos";
  const articles = p.articles || [], demarches = p.demarches || [];
  const rencs = rencontresForPerson(id);
  const st = personStats(id);
  const cag = p.cagnotte;
  const pct = cag && cag.objectif > 0 ? Math.min(100, Math.round((cag.collecte / cag.objectif) * 100)) : 0;

  Modal.open(p.nom || "Fiche", `
    <div class="detail-tabs">
      <button class="detail-tab ${active === "infos" ? "on" : ""}" data-tab="infos">Infos</button>
      <button class="detail-tab ${active === "articles" ? "on" : ""}" data-tab="articles">Articles (${articles.length})</button>
      <button class="detail-tab ${active === "demarches" ? "on" : ""}" data-tab="demarches">Démarches (${demarches.filter((d) => d.statut !== "done").length})</button>
      <button class="detail-tab ${active === "cagnotte" ? "on" : ""}" data-tab="cagnotte">Cagnotte</button>
      <button class="detail-tab ${active === "histo" ? "on" : ""}" data-tab="histo">Historique (${rencs.length})</button>
    </div>

    <div class="detail-pane ${active === "infos" ? "on" : ""}" data-pane="infos">
      <p><b>${esc(p.nom)}</b>${p.age ? ` · ${esc(p.age)} ans` : ""}</p>
      <p>${statutChip(p.statut)}</p>
      ${p.adresse ? `<p class="muted">🏠 ${esc(p.adresse)}</p>` : ""}
      <p class="muted">${p.lieu ? "📍 " + esc(p.lieu) : (p.adresse ? "" : "Lieu non précisé")}${p.animaux ? " · 🐾 " + esc(p.animaux) : ""}</p>
      ${(p.tel || p.email) ? `<p class="item-tags">
        ${p.tel ? `<a class="chip chip-ok" href="tel:${esc(p.tel)}">📞 ${esc(p.tel)}</a>` : ""}
        ${p.email ? `<a class="chip" href="mailto:${esc(p.email)}">✉️ ${esc(p.email)}</a>` : ""}
      </p>` : ""}
      ${(p.reseaux || []).length ? `<p class="item-tags">${p.reseaux.map((r) => {
        const u = socialUrl(r.reseau, r.pseudo);
        const lbl = `${socialIcon(r.reseau)} ${esc(r.reseau)} : ${esc(r.pseudo)}`;
        return u ? `<a class="chip" href="${esc(u)}" target="_blank" rel="noopener">${lbl}</a>` : `<span class="chip">${lbl}</span>`;
      }).join("")}</p>` : ""}
      ${p.notes ? `<p>📝 ${esc(p.notes)}</p>` : ""}
      <div class="grid stats" style="margin:14px 0">
        ${statCard("👁", st.count, "Rencontres")}
        ${statCard("📅", st.lastDate ? fmtDate(st.lastDate).split(",")[0] : "—", "Dernier contact")}
        ${statCard(st.alert ? "⚠️" : "🕒", st.count ? seenLabel(st.daysSince).replace("vu·e ", "") : "—", "Suivi")}
      </div>
      ${st.alert ? `<div class="priority-hint">⚠️ Pas vu·e depuis ${st.daysSince} jours — à re-visiter en priorité.</div>` : ""}
      <div class="form-row" style="margin-top:14px">
        <button class="btn secondary small" id="pd-edit">✎ Modifier</button>
        <button class="btn secondary small" id="pd-print">🖨️ Exporter</button>
      </div>
      <button class="btn danger small block" id="pd-del" style="margin-top:8px">🗑 Supprimer la fiche</button>
    </div>

    <div class="detail-pane ${active === "articles" ? "on" : ""}" data-pane="articles">
      <div class="list" style="margin-bottom:12px">
        ${articles.length ? articles.map((a) => `
          <div class="item" style="padding:10px">
            <button class="icon-btn" data-toggle-art="${a.id}" title="Fourni ?">${a.fourni ? "✅" : "⬜"}</button>
            <div class="item-body">
              <div class="item-title" style="${a.fourni ? "text-decoration:line-through;opacity:.6" : ""}">${esc(a.nom)} ${a.qte ? "×" + esc(a.qte) : ""}</div>
              <div class="item-tags"><span class="chip ${a.priorite === "haute" ? "chip-danger" : a.priorite === "basse" ? "chip-muted" : "chip-warn"}">${esc(a.priorite || "moyenne")}</span></div>
            </div>
            <button class="icon-btn" data-del-art="${a.id}">🗑</button>
          </div>`).join("") : `<div class="empty" style="padding:16px">Aucun article listé.</div>`}
      </div>
      <button class="btn small block" id="pd-add-art">＋ Ajouter un article/besoin</button>
    </div>

    <div class="detail-pane ${active === "demarches" ? "on" : ""}" data-pane="demarches">
      <div style="margin-bottom:12px">
        ${demarches.length ? demarches.map((d) => `
          <div class="demarche ${d.statut === "done" ? "is-done" : ""}">
            <div class="d-body">
              <div>${esc(d.libelle)}</div>
              ${d.echeance ? `<div class="item-sub">📅 ${esc(d.echeance)}${demarcheOverdue(d) ? " ⚠️ en retard" : ""}</div>` : ""}
              ${d.notes ? `<div class="item-sub">${esc(d.notes)}</div>` : ""}
            </div>
            <button class="d-status ${d.statut}" data-cycle-dem="${d.id}">${{ todo: "À faire", doing: "En cours", done: "Fait" }[d.statut]}</button>
            <button class="icon-btn" data-del-dem="${d.id}">🗑</button>
          </div>`).join("") : `<div class="empty" style="padding:16px">Aucune démarche.</div>`}
      </div>
      <button class="btn small block" id="pd-add-dem">＋ Ajouter une démarche</button>
    </div>

    <div class="detail-pane ${active === "cagnotte" ? "on" : ""}" data-pane="cagnotte">
      ${cag ? `
        <div class="cagnotte-box">
          <div class="cagnotte-amount">${esc(cag.collecte || 0)} € <span class="cagnotte-goal">/ ${esc(cag.objectif || 0)} € (${pct}%)</span></div>
          <div class="stock-bar" style="margin-top:8px"><span style="width:${pct}%"></span></div>
          <p style="margin:10px 0 4px"><b>${esc(cag.titre || "Cagnotte")}</b></p>
          ${cag.lien ? `<a class="chip chip-ok" href="${esc(cag.lien)}" target="_blank" rel="noopener">🔗 Ouvrir la cagnotte</a>` : `<span class="muted" style="font-size:12px">Pas encore de lien en ligne</span>`}
        </div>
        <div class="form-row" style="margin-top:12px">
          <button class="btn secondary small" id="pd-edit-cag">✎ Modifier</button>
          ${cag.lien ? `<button class="btn secondary small" id="pd-cag-qr">📱 QR</button>` : ""}
          <button class="btn danger small" id="pd-del-cag">🗑 Supprimer</button>
        </div>
        <p class="muted" style="font-size:12px;margin-top:10px">💡 Pour collecter réellement en ligne, crée la cagnotte sur une plateforme (ex. HelloAsso — sans frais pour les assos) et colle le lien ici.</p>
      ` : `
        <div class="empty" style="padding:16px"><span class="big">💶</span>Aucune cagnotte pour cette personne.</div>
        <button class="btn small block" id="pd-add-cag">＋ Créer une cagnotte</button>`}
    </div>

    <div class="detail-pane ${active === "histo" ? "on" : ""}" data-pane="histo">
      ${rencs.length ? `<div class="list">${rencs.map((r) => `
        <div class="item" style="padding:10px">
          <div class="item-ico">📍</div>
          <div class="item-body">
            <div class="item-title">${esc(r.lieu || "Lieu non précisé")}</div>
            <div class="item-sub">${fmtDate(r.date)}${r.benevole ? " · par " + esc(r.benevole) : ""}</div>
            ${(r.besoins || []).length ? `<div class="item-tags">${(r.besoins || []).map((b) => `<span class="chip">${esc(b)}</span>`).join("")}</div>` : ""}
            ${(r.distributions || []).length ? `<div class="item-sub">🎁 ${r.distributions.map((d) => esc(d.nom) + " ×" + d.qte).join(", ")}</div>` : ""}
          </div>
        </div>`).join("")}</div>` : `<div class="empty" style="padding:16px">Aucune rencontre enregistrée pour cette personne.<br><span class="muted">Elles apparaîtront ici quand tu rattacheras des rencontres du Terrain à cette fiche.</span></div>`}
    </div>`,
  (body) => {
    // Onglets
    $all(".detail-tab", body).forEach((t) => t.onclick = () => {
      $all(".detail-tab", body).forEach((x) => x.classList.toggle("on", x === t));
      $all(".detail-pane", body).forEach((pane) => pane.classList.toggle("on", pane.dataset.pane === t.dataset.tab));
    });
    // Infos
    if ($("#pd-edit", body)) $("#pd-edit", body).onclick = () => openPersonForm(getPerson(id));
    if ($("#pd-print", body)) $("#pd-print", body).onclick = () => exportPersonFiche(id);
    if ($("#pd-del", body)) $("#pd-del", body).onclick = () => {
      delItem("personnes", id); Modal.close(); toast("Fiche supprimée"); navigate("personnes");
    };
    // Articles
    if ($("#pd-add-art", body)) $("#pd-add-art", body).onclick = () => openArticleForm(id);
    $all("[data-toggle-art]", body).forEach((b) => b.onclick = () => {
      const per = getPerson(id); const a = per.articles.find((x) => x.id === b.dataset.toggleArt);
      a.fourni = !a.fourni; upsertPerson(per); openPersonDetail(id, "articles");
    });
    $all("[data-del-art]", body).forEach((b) => b.onclick = () => {
      const per = getPerson(id); per.articles = per.articles.filter((x) => x.id !== b.dataset.delArt);
      upsertPerson(per); openPersonDetail(id, "articles");
    });
    // Démarches
    if ($("#pd-add-dem", body)) $("#pd-add-dem", body).onclick = () => openDemarcheForm(id);
    $all("[data-cycle-dem]", body).forEach((b) => b.onclick = () => {
      const per = getPerson(id); const d = per.demarches.find((x) => x.id === b.dataset.cycleDem);
      d.statut = d.statut === "todo" ? "doing" : d.statut === "doing" ? "done" : "todo";
      upsertPerson(per); openPersonDetail(id, "demarches");
    });
    $all("[data-del-dem]", body).forEach((b) => b.onclick = () => {
      const per = getPerson(id); per.demarches = per.demarches.filter((x) => x.id !== b.dataset.delDem);
      upsertPerson(per); openPersonDetail(id, "demarches");
    });
    // Cagnotte
    if ($("#pd-add-cag", body)) $("#pd-add-cag", body).onclick = () => openCagnotteForm(id);
    if ($("#pd-edit-cag", body)) $("#pd-edit-cag", body).onclick = () => openCagnotteForm(id);
    if ($("#pd-cag-qr", body)) $("#pd-cag-qr", body).onclick = () => showQR(p.cagnotte.lien, "QR — Cagnotte", p.cagnotte.titre);
    if ($("#pd-del-cag", body)) $("#pd-del-cag", body).onclick = () => {
      const per = getPerson(id); per.cagnotte = null; upsertPerson(per); openPersonDetail(id, "cagnotte");
    };
  });
}

function openArticleForm(personId) {
  Modal.open("Ajouter un article", `
    <div class="field"><label>Article / besoin</label>
      <input id="a-nom" list="art-list" placeholder="Ex : duvet, croquettes…" />
      <datalist id="art-list">${window.ARTICLES_COURANTS.map((a) => `<option value="${a}">`).join("")}</datalist>
    </div>
    <div class="form-row">
      <div class="field"><label>Quantité</label><input id="a-qte" type="number" min="1" value="1" /></div>
      <div class="field"><label>Priorité</label><select id="a-prio"><option value="haute">Haute</option><option value="moyenne" selected>Moyenne</option><option value="basse">Basse</option></select></div>
    </div>
    <button class="btn block" id="a-save">Ajouter</button>`,
  (body) => {
    $("#a-save", body).onclick = () => {
      const nom = $("#a-nom").value.trim(); if (!nom) return toast("Nom de l'article requis");
      const per = getPerson(personId); per.articles = per.articles || [];
      per.articles.push({ id: uid(), nom, qte: +$("#a-qte").value || 1, priorite: $("#a-prio").value, fourni: false });
      upsertPerson(per); openPersonDetail(personId, "articles");
    };
  });
}

function openDemarcheForm(personId) {
  Modal.open("Ajouter une démarche", `
    <div class="field"><label>Démarche</label>
      <select id="d-type">
        <option value="">— Choisir un modèle —</option>
        ${window.DEMARCHES_TYPES.map((d) => `<option value="${esc(d)}">${esc(d)}</option>`).join("")}
        <option value="__custom">✎ Autre (saisie libre)</option>
      </select>
    </div>
    <div class="field hidden" id="d-custom-wrap"><label>Intitulé</label><input id="d-custom" placeholder="Démarche personnalisée" /></div>
    <div class="field"><label>Échéance / RDV (optionnel)</label><input id="d-date" type="date" /></div>
    <div class="field"><label>Notes (optionnel)</label><input id="d-notes" placeholder="Rendez-vous, référent…" /></div>
    <button class="btn block" id="d-save">Ajouter</button>`,
  (body) => {
    const sel = $("#d-type", body);
    sel.onchange = () => $("#d-custom-wrap", body).classList.toggle("hidden", sel.value !== "__custom");
    $("#d-save", body).onclick = () => {
      let libelle = sel.value === "__custom" ? $("#d-custom").value.trim() : sel.value;
      if (!libelle) return toast("Choisis ou saisis une démarche");
      const per = getPerson(personId); per.demarches = per.demarches || [];
      per.demarches.push({ id: uid(), libelle, statut: "todo", echeance: $("#d-date").value, notes: $("#d-notes").value.trim() });
      upsertPerson(per); openPersonDetail(personId, "demarches");
    };
  });
}

function openCagnotteForm(personId) {
  const per = getPerson(personId);
  const c = per.cagnotte || { titre: "", objectif: "", collecte: 0, lien: "", active: true };
  Modal.open("Cagnotte", `
    <div class="field"><label>Titre</label><input id="c-titre" value="${esc(c.titre)}" placeholder="Ex : Aider ${esc(per.nom)} à passer l'hiver" /></div>
    <div class="form-row">
      <div class="field"><label>Objectif (€)</label><input id="c-obj" type="number" min="0" value="${esc(c.objectif)}" /></div>
      <div class="field"><label>Déjà collecté (€)</label><input id="c-col" type="number" min="0" value="${esc(c.collecte)}" /></div>
    </div>
    <div class="field"><label>Lien de la cagnotte en ligne</label><input id="c-lien" value="${esc(c.lien)}" placeholder="https://www.helloasso.com/..." /></div>
    <button class="btn block" id="c-save">Enregistrer la cagnotte</button>`,
  (body) => {
    $("#c-save", body).onclick = () => {
      const titre = $("#c-titre").value.trim(); if (!titre) return toast("Donne un titre à la cagnotte");
      per.cagnotte = { titre, objectif: +$("#c-obj").value || 0, collecte: +$("#c-col").value || 0, lien: $("#c-lien").value.trim(), active: true };
      upsertPerson(per); openPersonDetail(personId, "cagnotte");
    };
  });
}

/* Affiche un QR code (généré via api.qrserver.com) dans une modale, imprimable */
function showQR(data, title, subtitle) {
  if (!data) return toast("Rien à encoder");
  const url = `https://api.qrserver.com/v1/create-qr-code/?size=260x260&margin=8&data=${encodeURIComponent(data)}`;
  Modal.open(title, `
    <div style="text-align:center">
      ${subtitle ? `<p class="muted">${esc(subtitle)}</p>` : ""}
      <img src="${esc(url)}" alt="QR code" style="width:220px;height:220px;background:#fff;border-radius:12px;padding:8px" />
      <p class="muted" style="word-break:break-all;font-size:12px">${esc(data)}</p>
      <button class="btn secondary small" id="qr-print">🖨️ Imprimer / partager</button>
    </div>`,
  (body) => {
    $("#qr-print", body).onclick = () => {
      const w = window.open("", "_blank"); if (!w) return toast("Autorise les fenêtres pop-up");
      w.document.write(`<div style="text-align:center;font-family:system-ui,sans-serif;padding:24px"><h3>${esc(title)}</h3>${subtitle ? `<p>${esc(subtitle)}</p>` : ""}<img src="${url}" style="width:300px"><p style="font-size:12px;color:#555;word-break:break-all">${esc(data)}</p></div>`);
      w.document.close(); setTimeout(() => { try { w.print(); } catch {} }, 500);
    };
  });
}

/* Export imprimable d'une fiche personne (→ PDF via l'impression du navigateur) */
function exportPersonFiche(id) {
  const p = getPerson(id);
  if (!p) return;
  const st = personStats(id), rencs = rencontresForPerson(id);
  const cag = p.cagnotte;
  const statutLbl = { todo: "À faire", doing: "En cours", done: "Fait" };
  const row = (k, v) => v ? `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>` : "";

  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<title>Fiche — ${esc(p.nom || "Personne")}</title>
<style>
  body{font-family:system-ui,Arial,sans-serif;color:#111;max-width:720px;margin:24px auto;padding:0 16px;line-height:1.5}
  h1{margin:0 0 2px;font-size:22px} h2{font-size:15px;margin:22px 0 8px;border-bottom:2px solid #111;padding-bottom:4px}
  .sub{color:#555;font-size:13px;margin-bottom:16px}
  table{border-collapse:collapse;width:100%;font-size:14px} th,td{text-align:left;padding:4px 8px;vertical-align:top}
  th{width:38%;color:#333;font-weight:600}
  ul{margin:6px 0;padding-left:20px} li{margin:3px 0;font-size:14px}
  .tag{display:inline-block;border:1px solid #999;border-radius:10px;padding:1px 7px;font-size:12px;margin-left:6px}
  .alert{background:#fff3cd;border:1px solid #ffe08a;padding:8px 12px;border-radius:6px;font-size:13px;margin:10px 0}
  .foot{margin-top:28px;font-size:11px;color:#777;border-top:1px solid #ccc;padding-top:8px}
  @media print{body{margin:0}}
</style></head><body>
  <h1>Fiche de suivi — ${esc(p.nom || "Personne")}</h1>
  <div class="sub">Association : ________________________ · Éditée le ${new Date().toLocaleDateString("fr-FR")}</div>
  ${st.alert ? `<div class="alert">⚠️ Personne pas vue depuis ${st.daysSince} jours.</div>` : ""}

  <h2>Informations</h2>
  <table>
    ${row("Situation", { rue: "À la rue", hebergement: "Hébergement temporaire", sorti: "Sorti·e de la rue" }[p.statut || "rue"])}
    ${row("Âge (approx.)", p.age ? p.age + " ans" : "")}
    ${row("Animaux", p.animaux)}
    ${row("Téléphone", p.tel)}
    ${row("Email", p.email)}
    ${row("Réseaux sociaux", (p.reseaux || []).map((r) => `${r.reseau} : ${r.pseudo}`).join("  ·  "))}
    ${row("Adresse / lieu où la trouver", p.adresse)}
    ${row("Repère", p.lieu)}
    ${row("Notes", p.notes)}
    ${row("Nombre de rencontres", String(st.count))}
    ${row("Dernier contact", st.lastDate ? fmtDate(st.lastDate) : "—")}
  </table>

  <h2>Articles / besoins</h2>
  ${(p.articles || []).length ? `<ul>${p.articles.map((a) => `<li>${esc(a.nom)}${a.qte ? " ×" + esc(a.qte) : ""} <span class="tag">${esc(a.priorite || "moyenne")}</span>${a.fourni ? ' <span class="tag">fourni</span>' : ""}</li>`).join("")}</ul>` : "<p>—</p>"}

  <h2>Démarches</h2>
  ${(p.demarches || []).length ? `<ul>${p.demarches.map((d) => `<li>${esc(d.libelle)} <span class="tag">${statutLbl[d.statut] || d.statut}</span>${d.echeance ? " — 📅 " + esc(d.echeance) : ""}${d.notes ? " — " + esc(d.notes) : ""}</li>`).join("")}</ul>` : "<p>—</p>"}

  ${cag ? `<h2>Cagnotte</h2><table>${row("Titre", cag.titre)}${row("Collecté", (cag.collecte || 0) + " € / " + (cag.objectif || 0) + " €")}${row("Lien", cag.lien)}</table>` : ""}

  <h2>Historique des rencontres (${rencs.length})</h2>
  ${rencs.length ? `<ul>${rencs.map((r) => `<li>${fmtDate(r.date)} — ${esc(r.lieu || "lieu ?")}${r.benevole ? " (par " + esc(r.benevole) + ")" : ""}${(r.besoins || []).length ? " : " + esc((r.besoins || []).join(", ")) : ""}</li>`).join("")}</ul>` : "<p>—</p>"}

  <div class="foot">Document confidentiel — données personnelles (RGPD). À usage strictement professionnel dans le cadre de l'accompagnement social. Ne pas diffuser sans base légale ni accord.</div>
</body></html>`;

  const w = window.open("", "_blank");
  if (!w) return toast("Autorise les fenêtres pop-up pour exporter");
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => { try { w.print(); } catch {} }, 400);
}

/* =========================================================================
   VUE — CARTE GLOBALE (personnes + rencontres + signalements + densité)
   ========================================================================= */
function renderCarteGlobale(root) {
  const persos = getPersonnes().filter((p) => p.lat && p.lng);
  const rencs = notDeleted(DB.get("rencontres", [])).filter((r) => r.lat && r.lng);
  const signs = notDeleted(DB.get("signalements", [])).filter((s) => s.lat && s.lng);

  root.innerHTML = `
    <div class="chips-select" id="carte-filter" style="margin-bottom:10px">
      <button class="chip-toggle on" data-l="personnes">🏠 Personnes (${persos.length})</button>
      <button class="chip-toggle on" data-l="rencontres">📍 Rencontres (${rencs.length})</button>
      <button class="chip-toggle on" data-l="signalements">🚨 Signalements (${signs.length})</button>
      <button class="chip-toggle" data-l="densite">🔥 Densité</button>
    </div>
    <div id="map" style="height:calc(100vh - 230px);min-height:340px"></div>`;

  const map = initMap("map", [48.8606, 2.3776], 12);
  if (!map.eachLayer) return; // hors-ligne : fallback géré par initMap

  const cm = (lat, lng, color, popup) => L.circleMarker([lat, lng], { radius: 7, color, weight: 2, fillColor: color, fillOpacity: 0.75 }).bindPopup(popup);
  const groups = {
    personnes: L.layerGroup(persos.map((p) => cm(p.lat, p.lng, "#34d399", `<b>${esc(p.nom || "?")}</b>${p.adresse ? "<br>" + esc(p.adresse) : ""}`))),
    rencontres: L.layerGroup(rencs.map((r) => cm(r.lat, r.lng, "#38bdf8", `${fmtDate(r.date)}<br>${esc(r.lieu || "")}`))),
    signalements: L.layerGroup(signs.map((s) => cm(s.lat, s.lng, "#f87171", esc(s.description || "Signalement")))),
    densite: L.layerGroup([...persos, ...rencs, ...signs].map((x) => L.circle([x.lat, x.lng], { radius: 160, stroke: false, fillColor: "#f97316", fillOpacity: 0.12 }))),
  };
  const active = { personnes: true, rencontres: true, signalements: true, densite: false };
  Object.keys(active).forEach((k) => { if (active[k]) groups[k].addTo(map); });

  const allPts = [...persos, ...rencs, ...signs].map((x) => [x.lat, x.lng]);
  if (allPts.length && map.fitBounds) { try { map.fitBounds(allPts, { padding: [40, 40], maxZoom: 15 }); } catch {} }

  $all("#carte-filter .chip-toggle").forEach((c) => c.onclick = () => {
    const k = c.dataset.l; active[k] = !active[k]; c.classList.toggle("on", active[k]);
    if (active[k]) groups[k].addTo(map); else map.removeLayer(groups[k]);
  });
}

/* =========================================================================
   RAPPORT D'ACTIVITÉ (PDF via impression) — pour les financeurs
   ========================================================================= */
function openRapportForm() {
  const now = new Date();
  Modal.open("Rapport d'activité", `
    <div class="field"><label>Période</label>
      <select id="rap-periode">
        <option value="mois">Ce mois-ci</option>
        <option value="annee">Cette année</option>
        <option value="tout" selected>Depuis le début</option>
      </select>
    </div>
    <p class="muted" style="font-size:12px">Génère un bilan imprimable (→ PDF) : maraudes, rencontres, personnes suivies, distributions, dons, démarches.</p>
    <button class="btn block" id="rap-go">📄 Générer le rapport</button>`,
  (body) => {
    $("#rap-go", body).onclick = () => {
      const p = $("#rap-periode").value;
      let from = 0, label = "Depuis le début";
      if (p === "mois") { from = new Date(now.getFullYear(), now.getMonth(), 1).getTime(); label = "Ce mois-ci (" + now.toLocaleDateString("fr-FR", { month: "long", year: "numeric" }) + ")"; }
      else if (p === "annee") { from = new Date(now.getFullYear(), 0, 1).getTime(); label = "Année " + now.getFullYear(); }
      exportRapport(from, label);
    };
  });
}

function exportRapport(from, label) {
  const inRange = (t) => (t || 0) >= from;
  const maraudes = notDeleted(DB.get("maraudes", [])).filter((m) => inRange(m.debut));
  const rencontres = notDeleted(DB.get("rencontres", [])).filter((r) => inRange(r.date));
  const dons = getDons().filter((d) => inRange(d.date));
  const signalements = notDeleted(DB.get("signalements", [])).filter((s) => inRange(s.date));
  const personnes = getPersonnes();

  // Distributions agrégées
  const distr = {}; let distrTotal = 0;
  rencontres.forEach((r) => (r.distributions || []).forEach((d) => { distr[d.nom] = (distr[d.nom] || 0) + d.qte; distrTotal += d.qte; }));
  // Dons par partenaire
  const donsPart = {}; let donsTotal = 0;
  dons.forEach((d) => { const k = d.partenaire || "—"; donsPart[k] = (donsPart[k] || 0) + (d.qte || 0); donsTotal += (d.qte || 0); });
  // Besoins fréquents
  const besoins = {}; rencontres.forEach((r) => (r.besoins || []).forEach((b) => besoins[b] = (besoins[b] || 0) + 1));
  const topBesoins = Object.entries(besoins).sort((a, b) => b[1] - a[1]).slice(0, 8);
  // Personnes par statut
  const parStatut = { rue: 0, hebergement: 0, sorti: 0 };
  personnes.forEach((p) => parStatut[p.statut || "rue"] = (parStatut[p.statut || "rue"] || 0) + 1);
  // Démarches par statut
  const dem = { todo: 0, doing: 0, done: 0 };
  personnes.forEach((p) => (p.demarches || []).forEach((d) => dem[d.statut] = (dem[d.statut] || 0) + 1));

  const li = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<li>${esc(k)} : <b>${v}</b></li>`).join("") || "<li>—</li>";
  const kpi = (n, l) => `<div class="kpi"><div class="kpi-n">${n}</div><div class="kpi-l">${l}</div></div>`;

  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<title>Rapport d'activité — Maraude</title>
<style>
  body{font-family:system-ui,Arial,sans-serif;color:#111;max-width:760px;margin:24px auto;padding:0 16px;line-height:1.5}
  h1{margin:0 0 2px;font-size:24px} h2{font-size:16px;margin:24px 0 8px;border-bottom:2px solid #111;padding-bottom:4px}
  .sub{color:#555;font-size:13px;margin-bottom:16px}
  .kpis{display:flex;flex-wrap:wrap;gap:12px;margin:12px 0}
  .kpi{border:1px solid #ccc;border-radius:10px;padding:12px 16px;min-width:120px;flex:1}
  .kpi-n{font-size:28px;font-weight:700} .kpi-l{font-size:12px;color:#555}
  ul{margin:6px 0;padding-left:20px} li{margin:3px 0;font-size:14px}
  .foot{margin-top:28px;font-size:11px;color:#777;border-top:1px solid #ccc;padding-top:8px}
  @media print{body{margin:0}}
</style></head><body>
  <h1>Rapport d'activité — Maraude</h1>
  <div class="sub">Association : ________________________ · Période : <b>${esc(label)}</b> · Édité le ${new Date().toLocaleDateString("fr-FR")}</div>

  <h2>Chiffres clés</h2>
  <div class="kpis">
    ${kpi(maraudes.length, "Maraudes réalisées")}
    ${kpi(rencontres.length, "Rencontres")}
    ${kpi(personnes.length, "Personnes suivies")}
    ${kpi(parStatut.sorti || 0, "Sorties de rue")}
    ${kpi(signalements.length, "Signalements")}
  </div>

  <h2>Personnes suivies (situation actuelle)</h2>
  <ul><li>À la rue : <b>${parStatut.rue || 0}</b></li><li>Hébergement temporaire : <b>${parStatut.hebergement || 0}</b></li><li>Sorties de rue : <b>${parStatut.sorti || 0}</b></li></ul>

  <h2>Distributions (${distrTotal} article(s))</h2>
  <ul>${li(distr)}</ul>

  <h2>Dons reçus (${donsTotal} unité(s))</h2>
  <ul>${li(donsPart)}</ul>

  <h2>Démarches d'accompagnement</h2>
  <ul><li>À faire : <b>${dem.todo}</b></li><li>En cours : <b>${dem.doing}</b></li><li>Réalisées : <b>${dem.done}</b></li></ul>

  <h2>Besoins les plus fréquents</h2>
  <ul>${topBesoins.map(([b, n]) => `<li>${esc(b)} : <b>${n}</b></li>`).join("") || "<li>—</li>"}</ul>

  <div class="foot">Rapport généré par l'app Maraude. Données agrégées, sans information nominative. À compléter avec le nom de l'association avant transmission.</div>
</body></html>`;

  const w = window.open("", "_blank");
  if (!w) return toast("Autorise les fenêtres pop-up pour le rapport");
  w.document.write(html); w.document.close(); w.focus();
  setTimeout(() => { try { w.print(); } catch {} }, 400);
}

/* =========================================================================
   VUE 7 — ADMIN / PERSONNEL
   ========================================================================= */
function renderAdmin(root) {
  const staff = notDeleted(DB.get("personnel", []));
  const dispo = staff.filter((s) => s.statut !== "indispo").length;
  root.innerHTML = `
    <div class="grid stats" style="margin-bottom:16px">
      ${statCard("👥", staff.length, "Personnel")}
      ${statCard("🟢", dispo, "Disponibles")}
      ${statCard("🟡", staff.length - dispo, "Indisponibles")}
    </div>
    <div class="section-head">
      <h2>Équipe de la maraude</h2>
      <button class="btn small" id="add-staff">＋ Personnel</button>
    </div>
    <div class="list">
      ${staff.length ? staff.map(staffCard).join("") : `<div class="empty"><span class="big">👥</span>Aucun membre. Ajoute ton équipe.</div>`}
    </div>`;

  $("#add-staff").onclick = () => openPersonnelForm();
  $all("[data-edit-staff]").forEach((b) => b.onclick = () => openPersonnelForm(DB.get("personnel", []).find((x) => x.id === b.dataset.editStaff)));
  $all("[data-toggle-staff]").forEach((b) => b.onclick = () => {
    const list = DB.get("personnel", []); const s = list.find((x) => x.id === b.dataset.toggleStaff);
    s.statut = s.statut === "indispo" ? "dispo" : "indispo"; DB.set("personnel", list); navigate("admin");
  });
  $all("[data-del-staff]").forEach((b) => b.onclick = () => { delItem("personnel", b.dataset.delStaff); navigate("admin"); });
}

function staffCard(s) {
  const indispo = s.statut === "indispo";
  return `<div class="item">
    <div class="avatar">${esc((s.nom || "?").trim().charAt(0).toUpperCase() || "?")}</div>
    <div class="item-body">
      <div class="item-title">${esc(s.nom)}</div>
      <div class="item-sub">${esc(s.role || "Bénévole")}${s.tel ? " · " + esc(s.tel) : ""}${s.email ? " · " + esc(s.email) : ""}</div>
      <div class="item-tags">
        <span class="chip ${indispo ? "chip-warn" : "chip-ok"}"><span class="staff-dot ${indispo ? "staff-indispo" : "staff-dispo"}"></span> ${indispo ? "Indisponible" : "Disponible"}</span>
      </div>
    </div>
    <div class="item-actions">
      <button class="icon-btn" data-toggle-staff="${s.id}" title="Changer la disponibilité">🔁</button>
      <button class="icon-btn" data-edit-staff="${s.id}" title="Modifier">✎</button>
      <button class="icon-btn" data-del-staff="${s.id}" title="Supprimer">🗑</button>
    </div>
  </div>`;
}

function openPersonnelForm(existing) {
  const s = existing || {};
  Modal.open(existing ? "Modifier le membre" : "Ajouter un membre", `
    <div class="field"><label>Nom</label><input id="st-nom" value="${esc(s.nom || "")}" /></div>
    <div class="field"><label>Rôle</label><select id="st-role">${window.PERSONNEL_ROLES.map((r) => `<option ${s.role === r ? "selected" : ""}>${r}</option>`).join("")}</select></div>
    <div class="form-row">
      <div class="field"><label>Téléphone</label><input id="st-tel" value="${esc(s.tel || "")}" /></div>
      <div class="field"><label>Email</label><input id="st-email" type="email" value="${esc(s.email || "")}" /></div>
    </div>
    <div class="field"><label>Disponibilité</label>
      <select id="st-statut"><option value="dispo" ${s.statut !== "indispo" ? "selected" : ""}>Disponible</option><option value="indispo" ${s.statut === "indispo" ? "selected" : ""}>Indisponible</option></select>
    </div>
    <button class="btn block" id="st-save">${existing ? "Enregistrer" : "Ajouter"}</button>`,
  (body) => {
    $("#st-save", body).onclick = () => {
      const nom = $("#st-nom").value.trim(); if (!nom) return toast("Nom requis");
      const list = DB.get("personnel", []);
      const member = existing ? { ...existing } : { id: uid() };
      Object.assign(member, { nom, role: $("#st-role").value, tel: $("#st-tel").value.trim(), email: $("#st-email").value.trim(), statut: $("#st-statut").value });
      const i = list.findIndex((x) => x.id === member.id);
      if (i >= 0) list[i] = member; else list.push(member);
      DB.set("personnel", list);
      Modal.close(); toast(existing ? "Membre mis à jour" : "Membre ajouté"); navigate("admin");
    };
  });
}

/* =========================================================================
   Helpers UI
   ========================================================================= */
function statCard(ico, val, lbl) {
  return `<div class="card stat"><span class="stat-ico">${ico}</span><div class="stat-val">${val}</div><div class="stat-lbl">${lbl}</div></div>`;
}

function initMap(id, center, zoom) {
  if (typeof L === "undefined") {
    const el = document.getElementById(id);
    if (el) el.innerHTML = `<div class="empty" style="padding:60px 20px"><span class="big">🗺️</span>Carte indisponible hors-ligne.<br><span class="muted">Reconnecte-toi pour charger le fond de carte.</span></div>`;
    return { on() {}, off() {}, eachLayer() {}, removeLayer() {}, getCenter: () => ({ lat: center[0], lng: center[1] }), remove() {} };
  }
  mapInstance = L.map(id, { zoomControl: true }).setView(center, zoom);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19, attribution: "© OpenStreetMap",
  }).addTo(mapInstance);
  return mapInstance;
}

function updateActiveChip() {
  const active = DB.get("maraudeActive", null);
  const chip = $("#maraude-active");
  if (active) { chip.textContent = `● Maraude ${active.secteur} en cours`; chip.className = "chip chip-ok"; }
  else { chip.textContent = "Aucune maraude en cours"; chip.className = "chip chip-muted"; }
}

/* ---------- Thème ---------- */
/* Renvoie le thème réellement appliqué en résolvant "auto" via prefers-color-scheme */
function resolvedTheme(t) {
  if (t !== "auto") return t;
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}
function applyTheme(t) {
  const real = resolvedTheme(t);
  document.documentElement.setAttribute("data-theme", real);
  DB.set("theme", t);
  $("#theme-toggle").textContent = t === "light" ? "☀️" : t === "auto" ? "🖥️" : "🌙";
  // En mode auto, bascule automatiquement quand le système change
  if (t === "auto" && window.matchMedia) {
    if (!applyTheme._autoBound) { applyTheme._autoBound = true; window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => { if (DB.get("theme", "dark") === "auto") applyTheme("auto"); }); }
  }
}
/* Cycle dark → light → auto → dark au clic sur le bouton thème */
function cycleTheme() {
  const cur = DB.get("theme", "dark");
  const next = cur === "dark" ? "light" : cur === "light" ? "auto" : "dark";
  applyTheme(next);
  toast(next === "auto" ? "Thème : auto (suit le système)" : "Thème : " + next);
}

/* ---------- Verrouillage par code PIN (#3) ---------- */
function hashPin(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return "h" + h.toString(36);
}
function showLock(onOk) {
  const scr = $("#lock-screen");
  scr.classList.remove("hidden");
  const input = $("#lock-pin"), err = $("#lock-err");
  input.value = ""; err.textContent = "";
  setTimeout(() => input.focus(), 100);
  const tryUnlock = () => {
    if (hashPin(input.value) === DB.get("pinHash", "")) {
      scr.classList.add("hidden"); onOk();
    } else { err.textContent = "Code incorrect"; input.value = ""; input.focus(); }
  };
  $("#lock-go").onclick = tryUnlock;
  input.onkeydown = (e) => { if (e.key === "Enter") tryUnlock(); };
}

/* ---------- Recherche globale (Ctrl/Cmd + K) ---------- */
/* Indexe personnes, ressources, rencontres, signalements, personnel → résultats groupés. */
function globalSearchIndex() {
  const out = [];
  getPersonnes().forEach((p) => out.push({ type: "personne", id: p.id, title: p.nom || "Sans nom", sub: [p.adresse, p.lieu].filter(Boolean).join(" · ") || "Personne suivie", ico: "🧑", view: "personnes", action: () => openPersonDetail(p.id) }));
  notDeleted(DB.get("ressources", [])).forEach((r) => out.push({ type: "ressource", id: r.id, title: r.nom || r.type, sub: `${r.type} · ${r.adresse || ""}`, ico: "🗺️", view: "ressources", action: () => { navigate("ressources"); } }));
  notDeleted(DB.get("rencontres", [])).forEach((r) => out.push({ type: "rencontre", id: r.id, title: r.lieu || "Rencontre", sub: fmtDate(r.date) + (r.prenom ? " · " + r.prenom : ""), ico: "📍", view: "terrain", action: () => { navigate("terrain"); } }));
  notDeleted(DB.get("signalements", [])).forEach((s) => out.push({ type: "signalement", id: s.id, title: (s.description || "Signalement").slice(0, 60), sub: fmtDate(s.date) + " · " + (s.statut || ""), ico: "🚨", view: "signalements", action: () => navigate("signalements") }));
  notDeleted(DB.get("stock", [])).forEach((s) => out.push({ type: "stock", id: s.id, title: s.nom + (s.taille ? " · T." + s.taille : ""), sub: `Stock : ${s.qte} restant(s)`, ico: "📦", view: "stock", action: () => navigate("stock") }));
  notDeleted(DB.get("personnel", [])).forEach((s) => out.push({ type: "personnel", id: s.id, title: s.nom || "Membre", sub: `${s.role || ""} · ${s.statut || ""}`, ico: "👥", view: "admin", action: () => navigate("admin") }));
  return out;
}

function openGlobalSearch() {
  Modal.open("🔎 Recherche globale", `
    <div class="field" style="margin-bottom:8px"><input id="gs-input" placeholder="Nom, lieu, ressource, signalement…" autocomplete="off" /></div>
    <div id="gs-results" style="max-height:50vh;overflow:auto"></div>
    <p class="muted" style="font-size:11px;margin-top:8px">Traverse personnes, ressources, rencontres, signalements, stock et personnel.</p>`,
  (body) => {
    const input = $("#gs-input", body), results = $("#gs-results", body);
    const all = globalSearchIndex();
    const render = (term) => {
      const t = term.trim().toLowerCase();
      let list = all;
      if (t) list = all.filter((x) => (x.title + " " + x.sub).toLowerCase().includes(t));
      // Limite à 30 résultats, groupés par type
      const grouped = {};
      list.slice(0, 30).forEach((x) => (grouped[x.type] = grouped[x.type] || []).push(x));
      if (!list.length) { results.innerHTML = `<div class="empty" style="padding:20px">Aucun résultat.</div>`; return; }
      const labels = { personne: "Personnes", ressource: "Ressources", rencontre: "Rencontres", signalement: "Signalements", stock: "Stock", personnel: "Personnel" };
      results.innerHTML = Object.entries(grouped).map(([type, items]) => `
        <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin:10px 0 4px;font-weight:600">${labels[type] || type}</div>
        ${items.map((x) => `<button class="gs-result" data-gs-id="${x.id}" data-gs-type="${x.type}" style="display:flex;gap:10px;align-items:center;width:100%;text-align:left;background:transparent;border:none;border-bottom:1px solid var(--border);padding:9px 4px;color:var(--text);cursor:pointer">
          <span style="font-size:18px">${x.ico}</span>
          <span style="flex:1;min-width:0"><span style="display:block;font-weight:600;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(x.title)}</span><span class="muted" style="font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block">${esc(x.sub)}</span></span>
        </button>`).join("")}`).join("");
      $all(".gs-result", body).forEach((b) => b.onclick = () => {
        const item = all.find((x) => x.id === b.dataset.gsId && x.type === b.dataset.gsType);
        if (!item) return;
        Modal.close();
        if (item.action) item.action();
      });
    };
    render("");
    input.oninput = () => render(input.value);
  });
}

/* ---------- Partage de l'application (QR code) ---------- */
function openShare() {
  $("#sidebar").classList.remove("open");
  const url = location.origin + location.pathname;
  const local = /^(localhost|127\.|0\.0\.0\.0|\[?::1)/i.test(location.hostname) || location.protocol === "file:";
  const qr = `https://api.qrserver.com/v1/create-qr-code/?size=260x260&margin=10&data=${encodeURIComponent(url)}`;
  Modal.open("📤 Partager l'application", `
    <p class="muted">Les bénévoles scannent ce QR code avec l'appareil photo de leur téléphone pour ouvrir l'application, puis « Ajouter à l'écran d'accueil ».</p>
    <div style="text-align:center;margin:14px 0">
      <img src="${qr}" alt="QR code vers l'application" width="230" height="230"
           style="background:#fff;border-radius:12px;padding:8px;max-width:100%"
           onerror="this.replaceWith(Object.assign(document.createElement('p'),{className:'muted',textContent:'QR indisponible (hors-ligne) — partage plutôt le lien ci-dessous.'}))" />
    </div>
    <div class="field"><label>Lien de l'application</label><input id="share-url" readonly value="${esc(url)}" /></div>
    <div class="form-row">
      <button class="btn secondary small" id="share-copy">📋 Copier le lien</button>
      ${navigator.share ? `<button class="btn secondary small" id="share-native">📲 Partager…</button>` : ""}
    </div>
    ${local ? `<p class="muted" style="font-size:12px;margin-top:12px;color:var(--warn)">⚠️ Adresse locale (<b>${esc(location.host)}</b>) : ce lien ne marche que sur cet appareil. Pour un accès en pleine rue, mets d'abord le site en ligne (voir README → « Mettre en ligne »).</p>` : ""}`,
  (body) => {
    $("#share-copy", body).onclick = async () => {
      try { await navigator.clipboard.writeText(url); toast("Lien copié ✅"); }
      catch { const i = $("#share-url", body); i.select(); try { document.execCommand("copy"); toast("Lien copié ✅"); } catch { toast("Copie impossible"); } }
    };
    const nat = $("#share-native", body);
    if (nat) nat.onclick = () => navigator.share({ title: "Maraude", text: "Application de terrain solidaire", url }).catch(() => {});
  });
}

/* ---------- Accès Admin protégé par mot de passe ---------- */
function promptAdminPass(onOk) {
  Modal.open("🔒 Accès Admin protégé", `
    <p class="muted">Cette section est réservée. Saisis le mot de passe.</p>
    <div class="field"><input id="admin-pass" type="password" autocomplete="off" placeholder="Mot de passe" /></div>
    <p id="admin-pass-err" class="muted" style="color:var(--danger,#e11)"></p>
    <button class="btn block" id="admin-pass-go">Déverrouiller</button>`,
  (body) => {
    const input = $("#admin-pass", body), err = $("#admin-pass-err", body);
    const tryUnlock = () => {
      if (hashPin(input.value) === DB.get("adminPassHash", "")) { Modal.close(); onOk(); }
      else { err.textContent = "Mot de passe incorrect"; input.value = ""; input.focus(); }
    };
    $("#admin-pass-go", body).onclick = tryUnlock;
    input.onkeydown = (e) => { if (e.key === "Enter") tryUnlock(); };
  });
}

/* ---------- Purge automatique (rétention RGPD) ---------- */
function purgeOld() {
  const months = DB.get("purgeMonths", 0);
  if (!months) return;
  const cutoff = Date.now() - months * 30 * 86400000;
  let purged = 0;
  ["rencontres", "signalements"].forEach((k) => {
    const list = DB.get(k, []);
    const kept = list.filter((x) => (x.date || x.createdAt || Date.now()) >= cutoff);
    if (kept.length !== list.length) { purged += list.length - kept.length; DB.set(k, kept); }
  });
  if (purged) setTimeout(() => toast(`Purge auto : ${purged} enregistrement(s) anciens supprimés`), 800);
}

/* ---------- État réseau ---------- */
function updateNet() {
  const on = navigator.onLine;
  $("#net-status").classList.toggle("offline", !on);
  $(".net-label").textContent = on ? "En ligne" : "Hors-ligne";
}

/* ---------- Mode Grand Froid (#3) ---------- */
function isCold() { return !!DB.get("grandFroid", false); }
function updateColdBanner() {
  const on = isCold();
  $("#cold-banner").classList.toggle("hidden", !on);
  document.documentElement.setAttribute("data-cold", on ? "on" : "off");
}
function toggleCold(on) {
  DB.set("grandFroid", on); updateColdBanner();
  toast(on ? "❄️ Plan Grand Froid activé" : "Plan Grand Froid désactivé");
  navigate(currentView);
}
const PRIORITE_FROID = ["Couverture", "Boisson chaude", "Orientation 115"];

/* ---------- Réglages + synchronisation bénévoles (#2) ---------- */
function profil() { return DB.get("profil", { benevole: "", equipe: "" }); }

function openSettings() {
  $("#sidebar").classList.remove("open");
  const p = profil();
  Modal.open("Réglages", `
    <div class="field"><label>Ton prénom (bénévole)</label><input id="cfg-benevole" value="${esc(p.benevole)}" placeholder="Ex : Sam" /></div>
    <div class="field"><label>Équipe / association</label><input id="cfg-equipe" value="${esc(p.equipe)}" placeholder="Ex : Maraude Est" /></div>

    <div class="field" style="display:flex;align-items:center;justify-content:space-between;gap:12px">
      <label style="margin:0">❄️ Mode Grand Froid</label>
      <button type="button" class="chip-toggle ${isCold() ? "on" : ""}" id="cfg-cold">${isCold() ? "Activé" : "Désactivé"}</button>
    </div>

    <hr style="border:none;border-top:1px solid var(--border);margin:16px 0" />
    <label style="font-size:13px;color:var(--text-muted);font-weight:600">Regrouper les données des bénévoles</label>
    <p class="muted" style="font-size:12px;margin-top:4px">Chaque bénévole <b>exporte</b> son fichier en fin de tournée (mail, clé USB…). Le coordinateur les <b>importe tous d'un coup</b> : fusion automatique, le plus récent l'emporte, rien n'est écrasé par erreur. Inclut rencontres, personnes, stock, dons, signalements, équipe…</p>
    <div class="form-row">
      <button class="btn secondary small" id="cfg-export">⬆ Exporter mes données</button>
      <button class="btn secondary small" id="cfg-import">⬇ Importer &amp; fusionner (multi)</button>
    </div>
    <input type="file" id="cfg-file" accept="application/json" multiple class="hidden" />

    <hr style="border:none;border-top:1px solid var(--border);margin:16px 0" />
    <label style="font-size:13px;color:var(--text-muted);font-weight:600">🔄 Synchronisation temps réel</label>
    <div class="field" style="margin-top:8px">
      <label>Mode</label>
      <select id="cfg-syncmode">
        <option value="off">Désactivée (100% local)</option>
        <option value="demo">Démo (serveur simulé — pour tester)</option>
        <option value="server">Serveur (PocketBase / URL)</option>
      </select>
    </div>
    <div class="field" id="cfg-url-wrap" style="display:none"><label>URL du serveur</label><input id="cfg-syncurl" placeholder="https://mon-asso.fr" /></div>
    <div id="cfg-demo-tools" style="display:none">
      <div class="form-row">
        <button type="button" class="btn secondary small" id="cfg-seed">👤 Simuler un autre bénévole</button>
        <button type="button" class="btn secondary small" id="cfg-reset">♻ Réinitialiser le cloud démo</button>
      </div>
    </div>
    <p class="muted" style="font-size:12px;margin-top:8px">🔒 Le champ « Médical » et les notes ne sont jamais synchronisés (RGPD). Voir docs/rgpd/.</p>

    <hr style="border:none;border-top:1px solid var(--border);margin:16px 0" />
    <label style="font-size:13px;color:var(--text-muted);font-weight:600">🔒 Sécurité & confidentialité</label>
    <div class="field" style="margin-top:8px">
      <label>Code PIN à l'ouverture</label>
      <div class="form-row" style="align-items:flex-end">
        <input id="cfg-pin" type="password" inputmode="numeric" autocomplete="off" placeholder="${DB.get("pinHash", "") ? "•••• (défini) — retaper pour changer" : "Définir un PIN"}" />
        <button type="button" class="btn secondary small" id="cfg-pin-clear" style="flex:0 0 auto">Retirer</button>
      </div>
    </div>
    <div class="field">
      <label>Mot de passe d'accès Admin</label>
      <div class="form-row" style="align-items:flex-end">
        <input id="cfg-adminpass" type="password" autocomplete="off" placeholder="${DB.get("adminPassHash", "") ? "•••••• (défini) — retaper pour changer" : "Définir un mot de passe"}" />
        <button type="button" class="btn secondary small" id="cfg-adminpass-clear" style="flex:0 0 auto">Retirer</button>
      </div>
    </div>
    <div class="field">
      <label>Purge auto des rencontres & signalements anciens</label>
      <select id="cfg-purge">
        <option value="0">Désactivée</option>
        <option value="3">Après 3 mois</option>
        <option value="6">Après 6 mois</option>
        <option value="12">Après 12 mois</option>
      </select>
    </div>

    <hr style="border:none;border-top:1px solid var(--border);margin:16px 0" />
    <label style="font-size:13px;color:var(--text-muted);font-weight:600">♿ Accessibilité & confort</label>
    <div class="field" style="margin-top:8px">
      <label>Taille du texte</label>
      <div class="chips-select" id="cfg-fontsize">
        <button type="button" class="chip-toggle" data-fs="small">A Petit</button>
        <button type="button" class="chip-toggle on" data-fs="normal">A Normal</button>
        <button type="button" class="chip-toggle" data-fs="large">A Grand</button>
      </div>
      <p class="muted" style="font-size:11px;margin-top:6px">Utile pour la lecture en soirée ou pour les bénévoles malvoyants.</p>
    </div>
    <div class="field">
      <label>Thème</label>
      <div class="chips-select" id="cfg-theme">
        <button type="button" class="chip-toggle" data-th="dark">🌙 Sombre</button>
        <button type="button" class="chip-toggle" data-th="light">☀️ Clair</button>
        <button type="button" class="chip-toggle" data-th="auto">🖥️ Auto</button>
      </div>
    </div>
    <div class="field">
      <label>💾 Sauvegarde automatique</label>
      <p class="muted" style="font-size:12px;margin:4px 0 8px">✅ Tes données restent sur cet appareil et <b>ne sont pas effacées par les mises à jour</b>. Sauvegarde auto : <span id="cfg-bk-date">—</span>.<br>📤 Dernier export (fichier) : <span id="cfg-export-date">—</span>.</p>
      <button type="button" class="btn secondary small" id="cfg-restore">♻ Restaurer la dernière sauvegarde</button>
    </div>

    <hr style="border:none;border-top:1px solid var(--border);margin:16px 0" />
    <label style="font-size:13px;color:var(--text-muted);font-weight:600">✉️ Contactez-moi</label>
    <p class="muted" style="font-size:12px;margin-top:4px">Une question, un bug, une idée&nbsp;? Écris-moi&nbsp;:</p>
    <a class="btn secondary small block" style="margin-top:6px" href="mailto:sdsb.2023@gmail.com?subject=Maraude%20—%20contact">📧 sdsb.2023@gmail.com</a>

    <button class="btn block" id="cfg-save" style="margin-top:14px">Enregistrer</button>

    <p class="muted" style="font-size:11px;text-align:center;margin-top:14px;opacity:.7">Maraude — Version 1.90 (bêta)</p>`,
  (body) => {
    let cold = isCold();
    $("#cfg-cold", body).onclick = (e) => {
      cold = !cold; e.target.classList.toggle("on", cold); e.target.textContent = cold ? "Activé" : "Désactivé";
    };
    $("#cfg-export", body).onclick = exportData;
    $("#cfg-import", body).onclick = () => $("#cfg-file", body).click();
    $("#cfg-file", body).onchange = (e) => importFiles(e.target.files);

    // Accessibilité — taille de texte
    let fontSize = DB.get("fontSize", "normal");
    $all("#cfg-fontsize .chip-toggle", body).forEach((c) => {
      c.classList.toggle("on", c.dataset.fs === fontSize);
      c.onclick = () => { fontSize = c.dataset.fs; $all("#cfg-fontsize .chip-toggle", body).forEach((x) => x.classList.toggle("on", x === c)); document.documentElement.setAttribute("data-font", fontSize); };
    });
    // Thème
    let themeChoice = DB.get("theme", "dark");
    $all("#cfg-theme .chip-toggle", body).forEach((c) => {
      c.classList.toggle("on", c.dataset.th === themeChoice);
      c.onclick = () => { themeChoice = c.dataset.th; $all("#cfg-theme .chip-toggle", body).forEach((x) => x.classList.toggle("on", x === c)); applyTheme(themeChoice); };
    });

    // Synchro
    const mode = $("#cfg-syncmode", body);
    mode.value = DB.get("syncMode", "off");
    $("#cfg-syncurl", body).value = DB.get("syncUrl", "");
    const refreshSyncUI = () => {
      $("#cfg-url-wrap", body).style.display = mode.value === "server" ? "block" : "none";
      $("#cfg-demo-tools", body).style.display = mode.value === "demo" ? "block" : "none";
    };
    mode.onchange = refreshSyncUI; refreshSyncUI();
    $("#cfg-seed", body).onclick = () => window.Sync && Sync.demoSeedOther();
    $("#cfg-reset", body).onclick = () => window.Sync && Sync.reset();

    // Sécurité
    $("#cfg-purge", body).value = String(DB.get("purgeMonths", 0));
    let clearPin = false;
    $("#cfg-pin-clear", body).onclick = () => { clearPin = true; $("#cfg-pin", body).value = ""; toast("Le PIN sera retiré en enregistrant"); };
    let clearAdminPass = false;
    $("#cfg-adminpass-clear", body).onclick = () => { clearAdminPass = true; $("#cfg-adminpass", body).value = ""; toast("Le mot de passe Admin sera retiré en enregistrant"); };

    // Sauvegarde / restauration
    const bk = window.Sync ? Sync.lastBackup() : 0;
    $("#cfg-bk-date", body).textContent = bk ? fmtDate(bk) : "aucune pour l'instant";
    const ex = DB.get("_lastExportAt", 0);
    $("#cfg-export-date", body).textContent = ex ? fmtDate(ex) : "jamais";
    $("#cfg-restore", body).onclick = () => {
      if (!window.Sync || !Sync.lastBackup()) return toast("Aucune sauvegarde disponible");
      if (Sync.restoreBackup()) { Modal.close(); updateColdBanner(); toast("Sauvegarde restaurée ✅"); navigate(currentView); }
      else toast("Restauration impossible");
    };

    $("#cfg-save", body).onclick = () => {
      DB.set("profil", { benevole: $("#cfg-benevole").value.trim(), equipe: $("#cfg-equipe").value.trim() });
      DB.set("grandFroid", cold);
      DB.set("fontSize", fontSize);
      DB.set("theme", themeChoice);
      DB.set("syncMode", mode.value);
      DB.set("syncUrl", $("#cfg-syncurl").value.trim());
      DB.set("purgeMonths", +$("#cfg-purge").value || 0);
      const newPin = $("#cfg-pin").value.trim();
      if (clearPin) DB.set("pinHash", "");
      else if (newPin) DB.set("pinHash", hashPin(newPin));
      const newAdminPass = $("#cfg-adminpass").value.trim();
      if (clearAdminPass) { DB.set("adminPassHash", ""); adminUnlocked = true; }
      else if (newAdminPass) { DB.set("adminPassHash", hashPin(newAdminPass)); adminUnlocked = true; }
      Modal.close(); updateColdBanner(); toast("Réglages enregistrés");
      if (window.Sync && mode.value !== "off") Sync.run();
      navigate(currentView);
    };
  });
}

const SYNC_KEYS = ["profil", "rencontres", "stock", "maraudes", "planned", "signalements", "ressources", "personnes", "personnel", "dons", "grandFroid"];

function exportData() {
  const data = { _app: "maraude", _version: 1, _exportedAt: Date.now() };
  SYNC_KEYS.forEach((k) => data[k] = DB.get(k, null));
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const who = (profil().benevole || "").trim().replace(/[^\p{L}\p{N}_-]+/gu, "-").replace(/^-+|-+$/g, "");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `maraude-${who ? who + "-" : ""}${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  DB.set("_lastExportAt", Date.now());
  toast("Sauvegarde exportée");
}

/* Rappel : incite à exporter une sauvegarde hors-appareil si trop ancienne */
function maybeRemindBackup() {
  const hasData = notDeleted(DB.get("rencontres", [])).length + notDeleted(DB.get("personnes", [])).length > 0;
  if (!hasData) return;
  const last = DB.get("_lastExportAt", 0);
  const days = last ? (Date.now() - last) / 86400000 : Infinity;
  if (days >= 7) setTimeout(() => toast("💾 Pense à exporter une sauvegarde (Réglages ⚙️)"), 2800);
}

/* Regroupement multi-bénévoles : importe et fusionne un ou plusieurs fichiers.
   Fusion LWW (le plus récent gagne) via Sync ; repli local si Sync absent. */
function importFiles(fileList) {
  const files = [...(fileList || [])];
  if (!files.length) return;
  let done = 0, added = 0, updated = 0, bad = 0;
  const finish = () => {
    if (done < files.length) return;
    updateColdBanner();
    if (bad === files.length) return toast("Aucun fichier Maraude valide");
    Modal.close();
    toast(`Fusion de ${files.length - bad} fichier(s) : ${added} ajout(s), ${updated} maj${bad ? " · " + bad + " ignoré(s)" : ""} ✅`);
    navigate(currentView);
  };
  files.forEach((file) => {
    const reader = new FileReader();
    reader.onload = () => {
      let obj;
      try { obj = JSON.parse(reader.result); } catch { obj = null; }
      if (!obj || obj._app !== "maraude") { bad++; done++; return finish(); }
      const res = (window.Sync && Sync.mergeFile) ? Sync.mergeFile(obj) : mergeFileFallback(obj);
      if (res) { added += res.added; updated += res.updated; }
      if (obj.profil && !profil().benevole) DB.set("profil", obj.profil);
      done++; finish();
    };
    reader.onerror = () => { bad++; done++; finish(); };
    reader.readAsText(file);
  });
}

/* Repli si la couche Sync n'est pas chargée : fusion LWW simple par updatedAt. */
function mergeFileFallback(obj) {
  const cols = ["rencontres", "stock", "maraudes", "planned", "signalements", "ressources", "personnes", "personnel", "dons"];
  let added = 0, updated = 0;
  cols.forEach((k) => {
    if (!Array.isArray(obj[k])) return;
    const cur = DB.get(k, []);
    const idx = {}; cur.forEach((x, i) => { if (x && x.id) idx[x.id] = i; });
    obj[k].forEach((rec) => {
      if (!rec || !rec.id) return;
      const i = idx[rec.id];
      if (i == null) { cur.push(rec); idx[rec.id] = cur.length - 1; added++; }
      else if ((rec.updatedAt || 0) >= (cur[i].updatedAt || 0)) { cur[i] = rec; updated++; }
    });
    DB.set(k, cur);
  });
  return { added, updated };
}

/* =========================================================================
   Amorçage
   ========================================================================= */
/* Migration des données entre versions (préserve les données existantes) */
const DATA_VERSION = 1;
function migrate() {
  // Place des futures migrations non destructives (jamais d'effacement des données).
  DB.set("_dataVersion", DATA_VERSION);
}

function boot() {
  document.documentElement.lang = "fr";
  migrate();
  applyTheme(DB.get("theme", "dark"));
  document.documentElement.setAttribute("data-font", DB.get("fontSize", "normal"));
  updateActiveChip();
  updateNet();
  updateColdBanner();

  $all(".nav-btn, .tab-btn").forEach((b) => b.onclick = () => navigate(b.dataset.view));
  $("#menu-toggle").onclick = () => $("#sidebar").classList.toggle("open");
  $("#theme-toggle").onclick = cycleTheme;
  $("#settings-btn").onclick = openSettings;
  $("#search-btn").onclick = openGlobalSearch;
  $("#sync-btn").onclick = () => { if (window.Sync) Sync.run(); else toast("Synchro non chargée"); };
  $("#share-btn").onclick = openShare;
  $("#modal-close").onclick = Modal.close;
  $("#modal-backdrop").onclick = (e) => { if (e.target.id === "modal-backdrop") Modal.close(); };
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") Modal.close(); });
  // Raccourci recherche globale : Ctrl/Cmd + K
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) {
      e.preventDefault();
      if (!$("#modal-backdrop").classList.contains("hidden")) return;
      openGlobalSearch();
    }
  });
  window.addEventListener("online", updateNet);
  window.addEventListener("offline", updateNet);

  purgeOld();
  if (DB.get("pinHash", "")) {
    $("#app").style.visibility = "hidden";
    showLock(() => { $("#app").style.visibility = "visible"; navigate("terrain"); });
  } else {
    navigate("terrain");
  }
  maybeRemindBackup();

  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  if ("Notification" in window && Notification.permission === "granted") setTimeout(() => fireDueReminders(false), 1500);
}
boot();
