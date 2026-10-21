'use strict';
(() => {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- Constantes terrain ----------
  const TERRAIN = { center: [48.5592, 2.9515], bbox: [[48.552, 2.942], [48.566, 2.962]] };
  const FLOORS = [
    { v: null, l: 'Dehors', long: 'Dehors' },
    { v: -1, l: '-1', long: 'Sous-sol (-1)' },
    { v: 0, l: 'RDC', long: 'Rez-de-chaussée' },
    { v: 1, l: '1er', long: '1er étage' },
    { v: 2, l: '2e', long: '2e étage' },
    { v: 3, l: '3e', long: '3e étage' },
  ];
  const ZTYPES = {
    chateau: { label: 'Château', color: '#f2a541', building: true, floors: [-1, 0, 1, 2, 3] },
    batiment: { label: 'Petit bâtiment', color: '#ff7f50', building: true, floors: [0, 1] },
    foret: { label: 'Forêt', color: '#5fbf6e' },
    plaine: { label: 'Plaine / ancien golf', color: '#c9d46b' },
    lac: { label: 'Lac / étang', color: '#4fa8e8' },
    neutre: { label: 'Zone neutre', color: '#d0d0d0' },
  };
  const PINGS = {
    ennemi: { label: 'Ennemi', color: '#ff5a4e', glyph: '!' },
    aide: { label: "Besoin d'aide", color: '#ffc43d', glyph: '+' },
    objectif: { label: 'Objectif', color: '#4fc3f7', glyph: '◆' },
    regroup: { label: 'Regroupement', color: '#9be564', glyph: 'R' },
  };
  const COLORS = ['#ff6b35', '#4fc3f7', '#9be564', '#f15bb5', '#fee440', '#c77dff'];
  const STALE = 30000, PING_TTL = 90000, OUT_RESET = 15000;

  const store = {
    get(k, d) { try { const v = localStorage.getItem('dt_' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('dt_' + k, JSON.stringify(v)); } catch { /* ignore */ } },
  };

  const S = {
    me: null, name: store.get('name', ''), color: store.get('color', COLORS[0]), room: store.get('room', 'domaine'),
    lat: null, lng: null, acc: null, manual: false, floor: null, lockFloor: false, zone: null, outsideSince: null,
    players: new Map(), zones: [], mode: null, draft: [], filter: 'all', lastSent: 0, lastSig: '', centered: false,
  };

  // ---------- Intro ----------
  const intro = $('#intro');
  setTimeout(() => intro.classList.add('out'), 1800);
  setTimeout(() => intro.remove(), 2400);

  // ---------- Outils ----------
  function toast(html, color, ms = 3500) {
    const t = document.createElement('div');
    t.className = 'toast';
    if (color) t.style.setProperty('--c', color);
    t.innerHTML = html;
    $('#toasts').appendChild(t);
    setTimeout(() => t.remove(), ms);
  }
  const R = 6371000, rad = (d) => d * Math.PI / 180;
  function dist(a, b, c, d) {
    const x = Math.sin(rad(c - a) / 2) ** 2 + Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(rad(d - b) / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  function bearing(a, b, c, d) {
    const y = Math.sin(rad(d - b)) * Math.cos(rad(c));
    const x = Math.cos(rad(a)) * Math.sin(rad(c)) - Math.sin(rad(a)) * Math.cos(rad(c)) * Math.cos(rad(d - b));
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }
  const cardinal = (deg) => ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'][Math.round(deg / 45) % 8];
  const fmtDist = (m) => (m < 1000 ? Math.round(m) + ' m' : (m / 1000).toFixed(1) + ' km');
  function ago(ts) {
    const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 5) return "à l'instant";
    if (s < 60) return 'il y a ' + s + ' s';
    return 'il y a ' + Math.round(s / 60) + ' min';
  }
  const initials = (n) => (String(n).trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?');
  const floorShort = (f) => FLOORS.find((o) => o.v === f)?.l ?? '';
  const floorLong = (f) => FLOORS.find((o) => o.v === f)?.long ?? '';
  const isBld = (z) => !!(z && ZTYPES[z.type]?.building);
  const floorsOf = (z) => (z?.floors?.length ? z.floors : (ZTYPES[z?.type]?.floors || []));

  function inPoly(lat, lng, coords) {
    let ins = false;
    for (let i = 0, j = coords.length - 1; i < coords.length; j = i++) {
      const [yi, xi] = coords[i], [yj, xj] = coords[j];
      if ((yi > lat) !== (yj > lat) && lng < (xj - xi) * (lat - yi) / (yj - yi) + xi) ins = !ins;
    }
    return ins;
  }
  function area(c) {
    let a = 0;
    for (let i = 0, j = c.length - 1; i < c.length; j = i++) a += (c[j][1] + c[i][1]) * (c[j][0] - c[i][0]);
    return Math.abs(a);
  }
  function zoneAt(lat, lng) {
    const hits = S.zones.filter((z) => inPoly(lat, lng, z.coords));
    if (!hits.length) return null;
    hits.sort((a, b) => (isBld(b) - isBld(a)) || area(a.coords) - area(b.coords));
    return hits[0];
  }
  function placeLabel(p) {
    if (p.lat == null) return 'Pas encore de position';
    if (p.floor != null) return (p.zone || 'Bâtiment') + ' · ' + floorLong(p.floor);
    return p.zone ? p.zone + ' · dehors' : 'Dehors';
  }
  function matchFilter(floor) {
    if (S.filter === 'all') return true;
    if (S.filter === 'out') return floor == null;
    return floor === +S.filter;
  }

  // ---------- Carte ----------
  const map = L.map('map', { zoomControl: false, maxZoom: 21, minZoom: 13 }).setView(TERRAIN.center, 17);
  const IGN = (layer, fmt) => `https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layer}&STYLE=normal&TILEMATRIXSET=PM&FORMAT=${fmt}&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}`;
  const BASES = [
    { id: 'ign', label: 'Satellite IGN', url: IGN('ORTHOIMAGERY.ORTHOPHOTOS', 'image/jpeg'), attr: '© IGN Géoplateforme' },
    { id: 'esri', label: 'Satellite Esri', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attr: '© Esri, Maxar' },
    { id: 'plan', label: 'Plan IGN', url: IGN('GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2', 'image/png'), attr: '© IGN Géoplateforme' },
  ];
  let baseIdx = Math.max(0, BASES.findIndex((b) => b.id === store.get('base', 'ign')));
  let baseLayer = null;
  function setBase(i) {
    baseIdx = i;
    if (baseLayer) map.removeLayer(baseLayer);
    const b = BASES[i];
    baseLayer = L.tileLayer(b.url, { maxNativeZoom: 19, maxZoom: 21, attribution: b.attr }).addTo(map);
    $('#btnLayer').textContent = b.label;
    store.set('base', b.id);
  }
  setBase(baseIdx);
  $('#btnLayer').onclick = () => setBase((baseIdx + 1) % BASES.length);

  const zoneLayer = L.layerGroup().addTo(map);
  const draftLayer = L.layerGroup().addTo(map);
  const playerLayer = L.layerGroup().addTo(map);
  const pingLayer = L.layerGroup().addTo(map);

  function renderZones() {
    zoneLayer.clearLayers();
    for (const z of S.zones) {
      const t = ZTYPES[z.type] || ZTYPES.plaine;
      L.polygon(z.coords, {
        color: t.color, weight: t.building ? 2.5 : 1.5, fillOpacity: t.building ? 0.22 : 0.08,
        dashArray: t.building ? null : '6 6', interactive: false,
      }).bindTooltip(esc(z.name), { permanent: true, direction: 'center', className: 'ztip', interactive: false }).addTo(zoneLayer);
    }
    $('#zoneCount').textContent = S.zones.length;
    $('#zoneList').innerHTML = S.zones.map((z) => {
      const t = ZTYPES[z.type] || ZTYPES.plaine;
      const fl = isBld(z) ? ' · ' + floorsOf(z).map(floorShort).join(' ') : '';
      return `<li><span class="sw" style="--c:${t.color}"></span><span class="nm">${esc(z.name)} <small>${esc(t.label + fl)}</small></span>`
        + `<button type="button" class="btn sm" data-del="${esc(z.id)}">Supprimer</button></li>`;
    }).join('') || '<li class="muted">Aucune zone pour l\'instant.</li>';
  }
  $('#zoneList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-del]');
    if (!b) return;
    if (b.dataset.armed) { sock.emit('zone:delete', b.dataset.del); return; }
    b.dataset.armed = '1';
    b.textContent = 'Confirmer ?';
    b.classList.add('danger');
    setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = 'Supprimer'; b.classList.remove('danger'); } }, 3000);
  });

  // ---------- Joueurs ----------
  const markers = new Map();
  const meP = () => ({ id: 'me', name: S.name || 'Moi', color: S.color, lat: S.lat, lng: S.lng, acc: S.acc, manual: S.manual, floor: S.floor, zone: S.zone?.name || null, rx: Date.now() });

  function iconFor(p, isMe) {
    const stale = !isMe && Date.now() - p.rx > STALE;
    const dim = !matchFilter(p.floor);
    return L.divIcon({
      className: '', iconSize: [0, 0],
      html: `<div class="pm${isMe ? ' me' : ''}${stale ? ' stale' : ''}${dim ? ' dim' : ''}" style="--c:${p.color}">`
        + `<span class="dot">${esc(initials(p.name))}</span>`
        + (p.floor != null ? `<b class="fl">${floorShort(p.floor)}</b>` : '')
        + `<span class="nm">${esc(isMe ? 'Moi' : p.name)}</span></div>`,
    });
  }
  function upsertMarker(id, p, isMe) {
    if (p.lat == null) { removeMarker(id); return; }
    const ll = [p.lat, p.lng];
    const r = p.manual ? 0 : (p.acc || 0);
    let e = markers.get(id);
    if (!e) {
      e = {
        c: L.circle(ll, { radius: r, color: p.color, weight: 1, fillOpacity: 0.08, interactive: false }).addTo(playerLayer),
        m: L.marker(ll, { icon: iconFor(p, isMe), zIndexOffset: isMe ? 1000 : 0, keyboard: false }).addTo(playerLayer),
      };
      e.m.on('click', () => focusPlayer(id));
      markers.set(id, e);
    } else {
      e.m.setLatLng(ll); e.m.setIcon(iconFor(p, isMe));
      e.c.setLatLng(ll); e.c.setRadius(r); e.c.setStyle({ color: p.color });
    }
  }
  function removeMarker(id) {
    const e = markers.get(id);
    if (!e) return;
    playerLayer.removeLayer(e.m); playerLayer.removeLayer(e.c);
    markers.delete(id);
  }
  function peers() { return [...S.players.values()].filter((p) => p.id !== S.me); }
  function focusPlayer(id) {
    const p = id === 'me' ? meP() : S.players.get(id);
    if (!p || p.lat == null) { toast('Pas encore de position pour ce joueur.'); return; }
    map.flyTo([p.lat, p.lng], Math.max(map.getZoom(), 19), { duration: 0.6 });
    toast(`<b>${esc(id === 'me' ? 'Toi' : p.name)}</b> — ${esc(placeLabel(p))}`, p.color, 2500);
  }

  function renderList() {
    const rows = [meP(), ...peers()];
    $('#count').textContent = rows.length;
    $('#list').innerHTML = rows.map((p) => {
      const isMe = p.id === 'me';
      const stale = !isMe && Date.now() - p.rx > STALE;
      let d = '';
      if (!isMe && S.lat != null && p.lat != null) {
        d = fmtDist(dist(S.lat, S.lng, p.lat, p.lng)) + ' ' + cardinal(bearing(S.lat, S.lng, p.lat, p.lng));
      }
      const age = isMe ? (S.manual ? 'placé à la main' : (S.acc ? '±' + Math.round(S.acc) + ' m' : '')) : (p.lat == null ? '' : ago(p.rx));
      return `<li><button type="button" class="row${stale ? ' stale' : ''}" data-id="${esc(p.id)}">`
        + `<span class="sw" style="--c:${p.color}"></span>`
        + `<span class="who"><b>${esc(isMe ? (S.name || 'Moi') + ' (moi)' : p.name)}</b><small>${esc(placeLabel(p))}</small></span>`
        + `<span class="meta">${esc(d)}<small>${esc(age)}</small></span></button></li>`;
    }).join('');
  }
  $('#list').addEventListener('click', (e) => { const b = e.target.closest('[data-id]'); if (b) focusPlayer(b.dataset.id); });
  $('#sheetHead').onclick = () => { const h = $('#sheetHead'); h.setAttribute('aria-expanded', h.getAttribute('aria-expanded') === 'false' ? 'true' : 'false'); };

  function renderAll() {
    upsertMarker('me', meP(), true);
    for (const p of peers()) upsertMarker(p.id, p, false);
    for (const id of markers.keys()) if (id !== 'me' && !S.players.has(id)) removeMarker(id);
    renderList();
    renderFloors();
  }
  setInterval(renderAll, 5000);

  // ---------- Étages ----------
  function renderFloors() {
    const z = S.zone;
    const bld = isBld(z);
    const avail = bld ? floorsOf(z) : null;
    $('#floors').innerHTML = FLOORS.map((f) => {
      const dis = bld && f.v !== null && !avail.includes(f.v);
      return `<button type="button" data-f="${f.v ?? 'null'}" aria-pressed="${S.floor === f.v}"${dis ? ' disabled' : ''}>${f.l}</button>`;
    }).join('');
    const w = $('#whereAmI');
    if (S.lat == null) w.textContent = 'Position en attente… (ou touche « Placer »)';
    else if (bld) w.innerHTML = `<b>${esc(z.name)}</b> · choisis ton niveau`;
    else w.innerHTML = z ? `<b>${esc(z.name)}</b> · ${S.floor == null ? 'dehors' : floorLong(S.floor)}` : (S.floor == null ? '<b>Dehors</b> · hors zone tracée' : `<b>${floorLong(S.floor)}</b> · hors zone tracée`);
  }
  function pulseFloors() {
    const f = $('#floors');
    f.classList.remove('pulse'); void f.offsetWidth; f.classList.add('pulse');
    try { navigator.vibrate?.(80); } catch { /* ignore */ }
  }
  $('#floors').addEventListener('click', (e) => {
    const b = e.target.closest('[data-f]');
    if (!b || b.disabled) return;
    const v = b.dataset.f === 'null' ? null : +b.dataset.f;
    S.floor = v;
    S.outsideSince = null;
    S.lockFloor = !isBld(S.zone) && v !== null;
    renderAll();
    send(true);
  });

  // ---------- Ma position ----------
  function refreshZone() {
    if (S.lat == null) return;
    const z = zoneAt(S.lat, S.lng);
    const wasBld = isBld(S.zone);
    S.zone = z;
    if (isBld(z)) {
      S.lockFloor = false;
      S.outsideSince = null;
      const fl = floorsOf(z);
      if (S.floor === null || !fl.includes(S.floor)) {
        S.floor = fl.includes(0) ? 0 : fl[0];
        if (!wasBld) pulseFloors();
      }
    } else if (S.floor !== null && !S.lockFloor) {
      if (!S.outsideSince) S.outsideSince = Date.now();
      else if (Date.now() - S.outsideSince > OUT_RESET) { S.floor = null; S.outsideSince = null; }
    }
  }
  function setMyPos(lat, lng, acc, manual) {
    S.lat = lat; S.lng = lng; S.acc = acc; S.manual = manual;
    refreshZone();
    renderAll();
    send(false);
  }
  function setGpsLabel(acc) {
    const g = $('#gps');
    g.className = 'gps' + (acc == null ? '' : acc <= 10 ? ' good' : acc <= 25 ? ' mid' : ' bad');
    g.textContent = S.manual ? 'GPS manuel' : (acc == null ? 'GPS …' : 'GPS ±' + Math.round(acc) + ' m');
  }

  let watchId = null;
  function startGps() {
    if (watchId !== null) return;
    if (!('geolocation' in navigator)) { toast('Ce navigateur ne donne pas accès au GPS.'); return; }
    if (!window.isSecureContext) toast('Le GPS ne fonctionne qu\'en HTTPS. Ouvre l\'appli via son adresse https://', '#ff5a4e', 6000);
    watchId = navigator.geolocation.watchPosition((pos) => {
      const c = pos.coords;
      if (!S.manual) { setMyPos(c.latitude, c.longitude, c.accuracy, false); setGpsLabel(c.accuracy); }
      if (!S.centered) {
        S.centered = true;
        if (dist(c.latitude, c.longitude, TERRAIN.center[0], TERRAIN.center[1]) < 3000) map.setView([c.latitude, c.longitude], 18);
      }
    }, (err) => {
      setGpsLabel(null);
      toast(err.code === 1 ? 'Localisation refusée : autorise-la dans les réglages du navigateur.' : 'GPS indisponible pour l\'instant. Tu peux te placer à la main.', '#ff5a4e', 5000);
    }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
  }

  let wakeLock = null;
  async function keepAwake() {
    try { if ('wakeLock' in navigator && document.visibilityState === 'visible' && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch { /* ignore */ }
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { keepAwake(); send(true); } });

  // ---------- Réseau ----------
  const sock = io({ transports: ['websocket', 'polling'] });
  const setConn = (on) => { $('#conn').classList.toggle('on', on); $('#conn').title = on ? 'Connecté' : 'Hors ligne'; };
  function join() { if (S.name) sock.emit('join', { room: S.room, name: S.name, color: S.color }); }
  sock.on('connect', () => { setConn(true); join(); });
  sock.on('disconnect', () => setConn(false));
  sock.on('init', (d) => {
    S.me = d.me;
    S.players = new Map(d.players.map((p) => [p.id, { ...p, rx: Date.now() }]));
    S.zones = d.zones || [];
    $('#roomName').textContent = d.room;
    renderZones();
    refreshZone();
    renderAll();
    send(true);
  });
  sock.on('player', (p) => {
    const isNew = !S.players.has(p.id);
    S.players.set(p.id, { ...p, rx: Date.now() });
    if (p.id !== S.me) {
      upsertMarker(p.id, S.players.get(p.id), false);
      if (isNew) toast(`<b>${esc(p.name)}</b> a rejoint l'escouade`, p.color, 2500);
    }
    renderList();
  });
  sock.on('left', (id) => {
    const p = S.players.get(id);
    S.players.delete(id);
    removeMarker(id);
    renderList();
    if (p) toast(`<b>${esc(p.name)}</b> s'est déconnecté`, p.color, 2500);
  });
  sock.on('zones', (z) => { S.zones = z; renderZones(); refreshZone(); renderAll(); send(true); });
  sock.on('ping', showPing);

  function send(force) {
    if (!sock.connected || S.lat == null || !S.me) return;
    const now = Date.now();
    const sig = S.floor + '|' + (S.zone?.id || '');
    if (!force && sig === S.lastSig && now - S.lastSent < 1500) return;
    S.lastSent = now; S.lastSig = sig;
    sock.emit('pos', { lat: S.lat, lng: S.lng, acc: S.acc, floor: S.floor, zone: S.zone?.name || null, ztype: S.zone?.type || null, manual: S.manual });
  }
  setInterval(() => { refreshZone(); send(true); }, 8000);

  // ---------- Modes (signal / placer / zones) ----------
  function setMode(m) {
    S.mode = m;
    document.body.classList.toggle('picking', !!m);
    $('#btnPing').classList.toggle('active', !!m && m.startsWith('ping:'));
    $('#btnPlace').classList.toggle('active', m === 'place');
    $('#btnEdit').classList.toggle('active', m === 'edit');
    $('#editPanel').hidden = m !== 'edit';
    $('#bottom').hidden = m === 'edit';
    if (m !== 'edit') { S.draft = []; renderDraft(); }
    const h = $('#hint');
    if (m && m.startsWith('ping:')) {
      const k = PINGS[m.slice(5)];
      h.innerHTML = `<p>Touche la carte pour placer « ${esc(k.label)} ».</p><button type="button" class="btn sm" id="hMe">À ma position</button><button type="button" class="btn sm" id="hX">Annuler</button>`;
      h.hidden = false;
      $('#hMe').onclick = () => { if (S.lat == null) { toast('Ta position est inconnue.'); return; } sendPing(S.lat, S.lng, m.slice(5)); };
      $('#hX').onclick = () => setMode(null);
    } else if (m === 'place') {
      h.innerHTML = '<p>Touche la carte là où tu te trouves.</p><button type="button" class="btn sm" id="hX">Annuler</button>';
      h.hidden = false;
      $('#hX').onclick = () => setMode(null);
    } else h.hidden = true;
  }

  $('#btnCenter').onclick = () => {
    if (S.lat == null) { map.flyTo(TERRAIN.center, 17); toast('Position inconnue : retour sur le domaine.'); return; }
    map.flyTo([S.lat, S.lng], Math.max(map.getZoom(), 19), { duration: 0.6 });
  };
  $('#btnPlace').onclick = () => {
    if (S.manual) {
      S.manual = false;
      $('#placeLbl').textContent = 'Placer';
      setGpsLabel(null);
      toast('Retour au GPS.');
      return;
    }
    setMode(S.mode === 'place' ? null : 'place');
  };
  $('#btnPing').onclick = () => { if (S.mode?.startsWith('ping:')) { setMode(null); return; } $('#pingModal').hidden = false; };
  $('#btnEdit').onclick = () => setMode(S.mode === 'edit' ? null : 'edit');

  $('#pingKinds').innerHTML = Object.entries(PINGS).map(([k, v]) => `<button type="button" data-k="${k}" style="--c:${v.color}"><span>${v.glyph}</span>${esc(v.label)}</button>`).join('');
  $('#pingKinds').addEventListener('click', (e) => { const b = e.target.closest('[data-k]'); if (!b) return; $('#pingModal').hidden = true; setMode('ping:' + b.dataset.k); });
  $('#pingCancel').onclick = () => { $('#pingModal').hidden = true; };

  function sendPing(lat, lng, kind) {
    const z = zoneAt(lat, lng);
    const floor = isBld(z) ? (S.zone?.id === z.id && S.floor != null ? S.floor : 0) : null;
    sock.emit('ping', { lat, lng, kind, floor });
    setMode(null);
  }
  function showPing(d) {
    const k = PINGS[d.kind] || PINGS.ennemi;
    const z = zoneAt(d.lat, d.lng);
    const where = (z ? z.name : '') + (d.floor != null ? ' · ' + floorShort(d.floor) : '');
    const m = L.marker([d.lat, d.lng], {
      zIndexOffset: 2000, keyboard: false,
      icon: L.divIcon({ className: '', iconSize: [0, 0], html: `<div class="ping" style="--c:${k.color}"><i></i><span>${esc(k.glyph)}</span><em>${esc(k.label)}${where ? ' · ' + esc(where) : ''}<br>${esc(d.name)}</em></div>` }),
    }).addTo(pingLayer);
    m.on('click', () => pingLayer.removeLayer(m));
    setTimeout(() => pingLayer.removeLayer(m), PING_TTL);
    if (d.id !== S.me) {
      let extra = '';
      if (S.lat != null) extra = ` — ${fmtDist(dist(S.lat, S.lng, d.lat, d.lng))} ${cardinal(bearing(S.lat, S.lng, d.lat, d.lng))}`;
      toast(`<b>${esc(d.name)}</b> : ${esc(k.label)}${where ? ' (' + esc(where) + ')' : ''}${esc(extra)}`, k.color, 6000);
      try { navigator.vibrate?.([150, 80, 150]); } catch { /* ignore */ }
    }
  }

  // ---------- Éditeur de zones ----------
  function renderDraft() {
    draftLayer.clearLayers();
    if (S.draft.length) {
      L.polyline(S.draft.length > 2 ? [...S.draft, S.draft[0]] : S.draft, { color: '#f2a541', weight: 2, dashArray: '4 4', interactive: false }).addTo(draftLayer);
      for (const p of S.draft) L.marker(p, { icon: L.divIcon({ className: '', iconSize: [0, 0], html: '<div class="vtx"></div>' }), interactive: false }).addTo(draftLayer);
    }
    $('#editInfo').textContent = S.draft.length
      ? `${S.draft.length} point${S.draft.length > 1 ? 's' : ''} posé${S.draft.length > 1 ? 's' : ''}. ${S.draft.length < 3 ? 'Il en faut au moins 3.' : 'Touche « Terminer » quand le contour est fermé.'}`
      : 'Touche la carte pour poser les coins du bâtiment ou de la zone. Zoome au maximum pour être précis.';
    $('#editDone').disabled = S.draft.length < 3;
  }
  $('#editUndo').onclick = () => { S.draft.pop(); renderDraft(); };
  $('#editClose').onclick = () => setMode(null);
  $('#editDone').onclick = () => {
    if (S.draft.length < 3) return;
    $('#zName').value = '';
    $('#zType').value = 'batiment';
    renderZoneFloors();
    $('#zoneModal').hidden = false;
    $('#zName').focus();
  };
  $('#zType').innerHTML = Object.entries(ZTYPES).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('');
  function renderZoneFloors() {
    const t = ZTYPES[$('#zType').value];
    $('#zFloorsSet').hidden = !t.building;
    $('#zFloors').innerHTML = FLOORS.filter((f) => f.v !== null).map((f) =>
      `<label><input type="checkbox" value="${f.v}"${t.building && t.floors.includes(f.v) ? ' checked' : ''}> ${f.l}</label>`).join('');
  }
  $('#zType').onchange = renderZoneFloors;
  $('#zCancel').onclick = () => { $('#zoneModal').hidden = true; };
  $('#zoneForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const type = $('#zType').value;
    const floors = [...$('#zFloors').querySelectorAll('input:checked')].map((i) => +i.value);
    if (ZTYPES[type].building && !floors.length) { toast('Coche au moins un niveau.'); return; }
    sock.emit('zone:add', { name: $('#zName').value, type, floors, coords: S.draft });
    $('#zoneModal').hidden = true;
    S.draft = [];
    renderDraft();
    toast('Zone enregistrée pour toute l\'équipe.', ZTYPES[type].color);
  });
  $('#zExport').onclick = () => {
    const blob = new Blob([JSON.stringify(S.zones, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'zones-domaine.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  $('#zImport').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try { sock.emit('zones:import', JSON.parse(await f.text())); toast('Zones importées.'); } catch { toast('Fichier invalide : il faut un export de zones (.json).', '#ff5a4e'); }
    e.target.value = '';
  };

  map.on('click', (e) => {
    const { lat, lng } = e.latlng;
    if (!S.mode) return;
    if (S.mode.startsWith('ping:')) sendPing(lat, lng, S.mode.slice(5));
    else if (S.mode === 'place') {
      S.manual = true;
      $('#placeLbl').textContent = 'GPS';
      setMyPos(lat, lng, null, true);
      setGpsLabel(null);
      setMode(null);
      toast('Position fixée à la main. Touche « GPS » pour reprendre le suivi.');
    } else if (S.mode === 'edit') { S.draft.push([lat, lng]); renderDraft(); }
  });

  // ---------- Filtre étage ----------
  $('#filter').onchange = (e) => { S.filter = e.target.value; renderAll(); };

  // ---------- Réglages / connexion ----------
  function openSetup() {
    $('#sName').value = S.name;
    $('#sRoom').value = S.room;
    $('#sColors').innerHTML = COLORS.map((c) => `<button type="button" role="radio" aria-checked="${c === S.color}" aria-label="${c}" data-c="${c}" style="--c:${c}"></button>`).join('');
    $('#setupModal').hidden = false;
  }
  $('#sColors').addEventListener('click', (e) => {
    const b = e.target.closest('[data-c]');
    if (!b) return;
    S.color = b.dataset.c;
    $('#sColors').querySelectorAll('button').forEach((x) => x.setAttribute('aria-checked', x === b));
  });
  $('#btnTeam').onclick = openSetup;
  $('#setupForm').addEventListener('submit', (e) => {
    e.preventDefault();
    S.name = $('#sName').value.trim().slice(0, 20);
    S.room = $('#sRoom').value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 24) || 'domaine';
    store.set('name', S.name); store.set('room', S.room); store.set('color', S.color);
    $('#roomName').textContent = S.room;
    $('#setupModal').hidden = true;
    if (sock.connected) join();
    startGps();
    keepAwake();
    renderAll();
  });

  // ---------- Carte hors-ligne ----------
  function tileXY(lat, lng, z) {
    const n = 2 ** z, r = rad(lat);
    return [Math.floor((lng + 180) / 360 * n), Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n)];
  }
  $('#btnOffline').onclick = async () => {
    const btn = $('#btnOffline');
    if (!navigator.serviceWorker?.controller) { toast('Recharge la page une fois, puis relance le téléchargement.'); return; }
    const b = BASES[baseIdx];
    const urls = [];
    const [[s, w], [n, e]] = TERRAIN.bbox;
    for (let z = 15; z <= 19; z++) {
      const [x0, y0] = tileXY(n, w, z), [x1, y1] = tileXY(s, e, z);
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) urls.push(L.Util.template(b.url, { x, y, z }));
    }
    btn.disabled = true;
    let done = 0;
    const next = async () => {
      while (urls.length) {
        const u = urls.pop();
        try { await fetch(u, { mode: 'no-cors' }); } catch { /* ignore */ }
        done++;
        if (done % 20 === 0) btn.textContent = `Téléchargement… ${done}`;
      }
    };
    const total = urls.length;
    await Promise.all(Array.from({ length: 6 }, next));
    btn.disabled = false;
    btn.textContent = 'Terrain téléchargé ✓';
    toast(`${total} tuiles « ${esc(b.label)} » gardées sur ce téléphone.`, '#9be564');
  };

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

  // ---------- Démarrage ----------
  renderZones();
  renderAll();
  setGpsLabel(null);
  if (!S.name) openSetup(); else { startGps(); }
  document.addEventListener('pointerdown', keepAwake, { once: true });
})();
