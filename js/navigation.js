// ============================================================
// NAVIGATION v8 : Valhalla (FR) + OSRM secours
// Tracé bleu sur la carte PRINCIPALE et sur la carte CONDUITE
// Anti-crash : zéro caméra, zéro marqueur, timeouts, try/catch
// ============================================================
import { map, driverMap } from './map.js';
import { S, me, getAll } from './state.js';
import { $, haversineKm } from './utils.js';
import { pushAlert, speak } from './notify.js';

const VALHALLA  = 'https://valhalla1.openstreetmap.de/route';
const OSRM      = 'https://router.project-osrm.org/route/v1/driving/';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const FAV_KEY   = 'fc_nav_favs';
const MODE_KEY  = 'fc_nav_mode';
const SRC='nav-route',  LINE='nav-route-line';
const SRC_D='nav-route-d', LINE_D='nav-route-d-line';

let nav = null;
let searchTimer = null;
const hooked = new WeakSet();
const pending = new WeakSet();

const safe = fn => { try { fn(); } catch(e){ console.warn('[Nav]', e.message); } };
const ready = m => !!(m && m.isStyleLoaded && m.isStyleLoaded());
const visible = m => !!(m && m.getContainer() && m.getContainer().offsetParent !== null);
const deferRefresh = () => setTimeout(() => { ensureLayer(); setRouteData(); }, 0);

async function fetchTimeout(url, opts = {}, ms = 8000){
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal });
    if (!r.ok) throw new Error('http ' + r.status);
    return r;
  } finally { clearTimeout(t); }
}

function decodePolyline(str, precision = 6){
  let index = 0, lat = 0, lng = 0, shift = 0, result = 0, byte = null;
  const coords = [];
  const factor = Math.pow(10, precision);
  while (index < str.length){
    shift = 0; result = 0;
    do { byte = str.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
    lat += ((result & 1) ? ~(result >> 1) : (result >> 1));
    shift = 0; result = 0;
    do { byte = str.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
    lng += ((result & 1) ? ~(result >> 1) : (result >> 1));
    coords.push([lng / factor, lat / factor]);
  }
  return coords.filter(p => isFinite(p[0]) && isFinite(p[1]));
}
function buildCum(coords){
  const cum = [0];
  for (let i = 1; i < coords.length; i++)
    cum.push(cum[i-1] + haversineKm(coords[i-1][1], coords[i-1][0], coords[i][1], coords[i][0]));
  return cum;
}
const fmtDist = m => m < 1000 ? `${Math.round(m/10)*10} m` : `${(m/1000).toFixed(1)} km`;
const routeMode = () => { try { return localStorage.getItem(MODE_KEY) || 'fastest'; } catch(e){ return 'fastest'; } };

function iconFor(t){
  switch (t){
    case 2: case 10: case 11: case 18: case 20: return '↱';
    case 3: case 15: case 14: case 19: case 21: return '↰';
    case 9:  return '⬈';
    case 16: return '⬉';
    case 12: case 13: return '↩';
    case 26: case 27: return '🔄';
    case 4: case 5: case 6: return '🏁';
    case 25: return '⤵';
    case 28: case 29: return '⛴';
    default: return '⬆';
  }
}

// ---------- Valhalla (options d'itinéraire) ----------
async function routeValhalla(from, to, mode){
  const body = {
    locations: [{ lat: from.lat, lon: from.lng }, { lat: to.lat, lon: to.lng }],
    directions_options: { language: 'fr-FR', units: 'kilometers' }
  };
  if (mode === 'shortest') body.costing = 'shortest';
  else {
    body.costing = 'auto';
    if (mode === 'no-highway') body.costing_options = { use_highways: 0.0 };
    if (mode === 'no-toll')    body.costing_options = { use_tolls: 0.0 };
  }
  const r = await fetchTimeout(VALHALLA, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  }, 6000);
  const j = await r.json();
  const leg = j.trip && j.trip.legs && j.trip.legs[0];
  if (!leg || !leg.shape) throw new Error('réponse Valhalla invalide');
  const coords = decodePolyline(leg.shape, 6);
  if (coords.length < 2) throw new Error('tracé Valhalla vide');
  return {
    engine: 'Valhalla', coords,
    maneuvers: (leg.maneuvers || []).map(m => ({
      begin: m.begin_shape_index || 0, end: m.end_shape_index || 0,
      text: m.instruction || '', type: m.type || 0, time: m.time || 0
    })),
    summary: { km: (j.trip.summary && j.trip.summary.length) || 0,
               min: ((j.trip.summary && j.trip.summary.time) || 0) / 60 }
  };
}

// ---------- OSRM secours ----------
function osrmType(st){
  const m = st.maneuver || {}, t = m.type || '', mod = m.modifier || '';
  if (t === 'depart') return 1;
  if (t === 'arrive') return 4;
  if (t === 'roundabout' || t === 'rotary') return 26;
  if (t === 'merge') return 25;
  if (mod === 'uturn') return 12;
  if (mod === 'sharp right') return 11;
  if (mod === 'right') return 10;
  if (mod === 'slight right') return 9;
  if (mod === 'sharp left') return 14;
  if (mod === 'left') return 15;
  if (mod === 'slight left') return 16;
  return 8;
}
function osrmText(st){
  const m = st.maneuver || {}, t = m.type || '', mod = m.modifier || '', name = st.name || '';
  const dir = { left:'à gauche', right:'à droite', 'slight left':'légèrement à gauche',
    'slight right':'légèrement à droite', 'sharp left':'franchement à gauche',
    'sharp right':'franchement à droite', straight:'tout droit', uturn:'demi-tour' }[mod] || '';
  let base;
  switch (t){
    case 'depart': base = 'Départ'; break;
    case 'arrive': base = 'Arrivée'; break;
    case 'turn': base = 'Tournez ' + dir; break;
    case 'new name': base = 'Continuez ' + dir; break;
    case 'merge': base = 'Insérez-vous ' + dir; break;
    case 'on ramp': base = 'Prenez la bretelle ' + dir; break;
    case 'off ramp': base = 'Sortez ' + dir; break;
    case 'roundabout': case 'rotary': base = 'Au rond-point, sortie ' + (m.exit || ''); break;
    case 'end of road': base = 'Au bout, ' + dir; break;
    default: base = 'Continuez ' + dir;
  }
  return name ? base + ' sur ' + name : base;
}
async function routeOSRM(from, to){
  const r = await fetchTimeout(`${OSRM}${from.lng},${from.lat};${to.lng},${to.lat}?steps=true&geometries=geojson&overview=full`, {}, 8000);
  const j = await r.json();
  const rt = j.routes && j.routes[0];
  if (!rt) throw new Error('itinéraire OSRM introuvable');
  const coords = (rt.geometry.coordinates || []).filter(p => isFinite(p[0]) && isFinite(p[1]));
  if (coords.length < 2) throw new Error('tracé OSRM vide');
  let idx = 0; const maneuvers = [];
  for (const leg of rt.legs || []) for (const st of leg.steps || []) {
    const n = (st.geometry && st.geometry.coordinates) ? st.geometry.coordinates.length : 1;
    const begin = idx, end = Math.min(coords.length - 1, idx + n - 1);
    maneuvers.push({ begin, end, text: osrmText(st), type: osrmType(st) });
    idx = end;
  }
  return { engine: 'OSRM', coords, maneuvers, summary: { km: rt.distance / 1000, min: rt.duration / 60 } };
}

// ---------- Couche tracé sur UNE carte (générique) ----------
function ensureOn(m, src, line){
  if (!m) return;
  if (!ready(m)){
    if (!pending.has(m)){
      pending.add(m);
      m.once('style.load', () => { pending.delete(m); deferRefresh(); });
    }
    return;
  }
  if (!hooked.has(m)){
    hooked.add(m);
    m.on('style.load', () => { if (nav) deferRefresh(); });
  }
  safe(() => {
    if (!m.getSource(src))
      m.addSource(src, { type:'geojson', data:{ type:'Feature', geometry:{ type:'LineString', coordinates:[] } } });
    if (!m.getLayer(line))
      m.addLayer({ id:line, type:'line', source:src,
        layout:{ 'line-cap':'round', 'line-join':'round' },
        paint:{ 'line-color':'#1a73e8', 'line-width':6, 'line-opacity':0.95 } });
  });
}
function setOn(m, src){
  if (!m || !nav) return;
  const s = m.getSource(src);
  if (s) safe(() => s.setData({ type:'Feature', geometry:{ type:'LineString', coordinates: nav.coords || [] } }));
}
function ensureLayer(){
  ensureOn(map, SRC, LINE);
  if (visible(driverMap)) ensureOn(driverMap, SRC_D, LINE_D);
}
function setRouteData(){
  setOn(map, SRC);
  if (visible(driverMap)) setOn(driverMap, SRC_D);
}
function clearRoute(){
  for (const [m, src] of [[map, SRC], [driverMap, SRC_D]]){
    if (m && m.getSource(src))
      safe(() => m.getSource(src).setData({ type:'Feature', geometry:{ type:'LineString', coordinates:[] } }));
  }
}

// ---------- Bandeau enrichi ----------
function setBanner(icon, instr, next, dist, eta, arrive){
  safe(() => {
    $('#nav-icon').textContent = icon;
    $('#nav-instr').textContent = instr;
    $('#nav-next').textContent = next || '';
    $('#nav-dist').textContent = dist;
    $('#nav-eta').textContent = eta;
    $('#nav-arrive').textContent = arrive;
  });
}
function setProgress(pct){
  safe(() => { $('#nav-progress-fill').style.width = Math.min(100, Math.max(0, pct)) + '%'; });
}
function etaText(remainKm){
  if (!nav || !nav.summary || !nav.summary.km || !nav.summary.min) return '';
  const speed = nav.summary.km / nav.summary.min;
  return `${remainKm.toFixed(1)} km · ${Math.max(1, Math.round(remainKm / speed))} min`;
}
function arrivalText(remainKm){
  if (!nav || !nav.summary || !nav.summary.km || !nav.summary.min) return '';
  const speed = nav.summary.km / nav.summary.min;
  const d = new Date(Date.now() + (remainKm / speed) * 60000);
  return 'arr ' + d.toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit' });
}
function nextManeuver(){
  if (!nav || !nav.maneuvers || !nav.maneuvers.length) return null;
  return nav.maneuvers.find(m => m.begin >= nav.idx && m.type !== 1) || nav.maneuvers[nav.maneuvers.length - 1];
}
function maneuverAfter(nm){
  if (!nm) return null;
  const i = nav.maneuvers.indexOf(nm);
  for (let k = i + 1; k < nav.maneuvers.length; k++){
    if (nav.maneuvers[k].type !== 1) return nav.maneuvers[k];
  }
  return null;
}
function updateBanner(){
  if (!nav) return;
  if (!nav.coords.length){
    setBanner('⏳', nav.computing ? 'Calcul de l’itinéraire…' : 'En attente du GPS…', '', '', '', '');
    setProgress(0);
    return;
  }
  const remainKm = Math.max(0, nav.total - (nav.cum[nav.idx] || 0));
  const nm = nextManeuver();
  const nm2 = maneuverAfter(nm);
  const pct = nav.total > 0 ? (1 - remainKm / nav.total) * 100 : 0;
  if (nm){
    const dToMan = Math.max(0, (nav.cum[nm.begin] || 0) - (nav.cum[nav.idx] || 0)) * 1000;
    setBanner(iconFor(nm.type), nm.text || 'Continuez',
      nm2 ? 'puis ' + (nm2.text || '').slice(0, 42) : '',
      'dans ' + fmtDist(dToMan), etaText(remainKm), arrivalText(remainKm));
  } else {
    setBanner('⬆', 'Continuez', '', '', etaText(remainKm), arrivalText(remainKm));
  }
  setProgress(pct);
}

// ---------- Annonces adaptatives ----------
function thresholds(){
  const s = me.speed || 0;
  if (s >= 80) return [1000, 300];
  if (s >= 50) return [500, 150];
  return [200, 50];
}
function announce(nm, dToMan){
  for (const th of thresholds()){
    const key = nm.begin + ':' + th;
    if (dToMan <= th && !nav.announced.has(key)){
      nav.announced.add(key);
      speak(`Dans ${Math.round(dToMan/10)*10} mètres, ${nm.text}`);
    }
  }
  if (dToMan < 25 && !nav.announced.has(nm.begin + ':now')){
    nav.announced.add(nm.begin + ':now');
    speak(nm.text);
  }
}

// ---------- Cœur ----------
function memberPos(){
  const v = getAll()[nav.memberId];
  return (v && v.lat != null && v.lng != null) ? { lat: v.lat, lng: v.lng, name: v.name } : null;
}
async function computeRoute(){
  if (!nav || nav.computing) return;
  nav.computing = true;
  updateBanner();
  try {
    const to = nav.memberId ? memberPos() : nav.dest;
    if (!to) throw new Error('destination indisponible');
    nav.dest.lat = to.lat; nav.dest.lng = to.lng;
    let r = null;
    try { r = await routeValhalla({ lat: me.lat, lng: me.lng }, to, nav.mode); }
    catch(ev){
      console.warn('[Nav] Valhalla KO (' + ev.message + ') → OSRM');
      r = await routeOSRM({ lat: me.lat, lng: me.lng }, to);
    }
    if (!nav) return;
    nav.coords = r.coords; nav.cum = buildCum(r.coords);
    nav.total = nav.cum[nav.cum.length - 1];
    nav.maneuvers = r.maneuvers; nav.summary = r.summary; nav.engine = r.engine;
    nav.idx = 0; nav.announced = new Set(); nav.offCount = 0;
    deferRefresh();
    console.log('[Nav] OK via', r.engine, '(', nav.mode, ') :', nav.coords.length, 'points,', nav.total.toFixed(2), 'km');
  } catch(e){
    console.warn('[Nav] échec total :', e.message);
    pushAlert('❌ Itinéraire impossible (' + e.message + ')', 'warn', 5000);
    stopNavigation(true);
    return;
  } finally {
    if (nav) nav.computing = false;
    updateBanner();
  }
}
function nearestIndex(){
  const c = nav.coords;
  const start = Math.max(0, nav.idx - 3), end = Math.min(c.length - 1, nav.idx + 60);
  let best = nav.idx, bd = Infinity;
  for (let i = start; i <= end; i++){
    const d = haversineKm(me.lat, me.lng, c[i][1], c[i][0]);
    if (d < bd){ bd = d; best = i; }
  }
  return best;
}

export function navigationTick(){
  safe(() => {
    if (!nav || me.lat == null || me.lng == null || !map) return;

    // 🛡️ Réparation : couche manquante sur l'une des deux cartes visibles
    if (nav.coords.length){
      if (ready(map) && !map.getSource(SRC)) deferRefresh();
      if (visible(driverMap) && ready(driverMap) && !driverMap.getSource(SRC_D)) deferRefresh();
    }

    if (nav.computing) return;
    if (!nav.coords.length) return;

    if (nav.memberId){
      const mp = memberPos();
      if (!mp){ pushAlert('📵 Membre perdu, navigation arrêtée', 'warn'); stopNavigation(); return; }
      if (haversineKm(mp.lat, mp.lng, nav.dest.lat, nav.dest.lng) > 0.2 && Date.now() - nav.lastMemberRefresh > 30000){
        nav.lastMemberRefresh = Date.now();
        nav.dest.lat = mp.lat; nav.dest.lng = mp.lng;
        computeRoute();
      }
    }

    nav.idx = nearestIndex();
    if (haversineKm(me.lat, me.lng, nav.dest.lat, nav.dest.lng) < 0.04){
      speak('Vous êtes arrivé à destination', { interrupt:true });
      pushAlert('🏁 Arrivé à destination', 'success', 5000);
      stopNavigation(true);
      return;
    }

    const off = haversineKm(me.lat, me.lng, nav.coords[nav.idx][1], nav.coords[nav.idx][0]);
    const threshold = Math.max(0.08, (me.accuracy || 30) / 1000 + 0.05);
    nav.offCount = off > threshold ? (nav.offCount || 0) + 1 : 0;
    if (nav.offCount >= 3 && Date.now() - nav.lastReroute > 20000){
      nav.lastReroute = Date.now(); nav.offCount = 0;
      pushAlert('🔁 Recalcul de l’itinéraire', 'info', 2500);
      computeRoute();
    }

    const nm = nextManeuver();
    if (nm) announce(nm, Math.max(0, (nav.cum[nm.begin] || 0) - (nav.cum[nav.idx] || 0)) * 1000);
    updateBanner();
  });
}

export async function startNavigation(dest){
  if (me.lat == null || me.lng == null){ pushAlert('⚠️ GPS requis pour naviguer', 'warn'); return; }
  stopNavigation(true);
  nav = { dest:{ ...dest }, memberId: dest.memberId || null, coords:[], cum:[], total:0,
          maneuvers:[], idx:0, announced:new Set(), offCount:0, engine:null, mode: routeMode(),
          lastReroute:0, lastMemberRefresh:0, computing:false, summary:null };
  S.followId = me.id;
  $('#btn-nav').classList.add('active');
  $('#nav-banner').classList.remove('hidden');
  $('#nav-overlay').classList.add('hidden');
  setBanner('⏳', 'Calcul de l’itinéraire…', '', '', '', '');
  setProgress(0);
  await computeRoute();
  if (nav) speak('Navigation démarrée vers ' + nav.dest.name, { interrupt:true });
}
export function stopNavigation(silent){
  nav = null;
  clearRoute();
  S.followId = null;
  safe(() => {
    $('#nav-banner').classList.add('hidden');
    $('#btn-nav').classList.remove('active');
  });
  if (!silent) pushAlert('🧭 Navigation arrêtée', 'info', 2000);
}
export function isNavigating(){ return !!nav; }

// ---------- Favoris ----------
const getFavs = () => { try { return JSON.parse(localStorage.getItem(FAV_KEY) || '[]'); } catch(e){ return []; } };
const setFavs = f => localStorage.setItem(FAV_KEY, JSON.stringify(f));

// ---------- Overlay ----------
function renderMembers(){
  const all = getAll();
  const rows = Object.entries(all).filter(([id, v]) => id !== me.id && v.lat != null)
    .map(([id, v]) => `<div class="nav-item" data-member="${id}">🚗 ${v.name}</div>`).join('');
  $('#nav-members').innerHTML = rows || '<div class="nav-empty">Aucun membre connecté</div>';
}
function renderFavs(){
  const f = getFavs();
  $('#nav-favs').innerHTML = f.length ? f.map((x, i) =>
    `<div class="nav-item" data-fav="${i}">⭐ ${x.name}<span class="nav-del" data-fav-del="${i}">🗑</span></div>`).join('')
    : '<div class="nav-empty">Aucun favori</div>';
}
async function search(q){
  const box = $('#nav-results');
  if (q.length < 3){ box.innerHTML = ''; return; }
  box.innerHTML = '<div class="nav-empty">Recherche…</div>';
  try {
    const r = await fetchTimeout(`${NOMINATIM}?format=json&q=${encodeURIComponent(q)}&limit=5&accept-language=fr`, {}, 7000);
    const j = await r.json();
    box.innerHTML = j.length ? j.map(x =>
      `<div class="nav-item" data-lat="${x.lat}" data-lng="${x.lon}" data-name="${(x.display_name||'').replace(/"/g,'&quot;')}">📍 ${(x.display_name||'').slice(0,60)}</div>`).join('')
      : '<div class="nav-empty">Aucun résultat</div>';
  } catch(e){ box.innerHTML = '<div class="nav-empty">Recherche indisponible</div>'; }
}
export function openNavOverlay(){
  renderMembers(); renderFavs();
  $('#nav-search').value = ''; $('#nav-results').innerHTML = '';
  $('#nav-route-mode').value = routeMode();
  $('#nav-overlay').classList.remove('hidden');
}

// ---------- Bindings ----------
export function bindNavigationUI(){
  $('#btn-nav').onclick = () => { if (nav) stopNavigation(); else openNavOverlay(); };
  $('#btn-close-nav').onclick = () => $('#nav-overlay').classList.add('hidden');
  $('#nav-route-mode').onchange = e => localStorage.setItem(MODE_KEY, e.target.value);
  $('#nav-search').addEventListener('input', e => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => search(e.target.value.trim()), 500);
  });
  $('#nav-results').addEventListener('click', e => {
    const it = e.target.closest('[data-lat]'); if (!it) return;
    startNavigation({ lat:+it.dataset.lat, lng:+it.dataset.lng, name: it.dataset.name });
  });
  $('#nav-members').addEventListener('click', e => {
    const row = e.target.closest('[data-member]'); if (!row) return;
    const v = getAll()[row.dataset.member];
    if (v) startNavigation({ lat:v.lat, lng:v.lng, name:v.name, memberId: row.dataset.member });
  });
  $('#nav-favs').addEventListener('click', e => {
    const del = e.target.closest('[data-fav-del]');
    if (del){ const a = getFavs(); a.splice(+del.dataset.favDel, 1); setFavs(a); renderFavs(); return; }
    const row = e.target.closest('[data-fav]'); if (!row) return;
    const f = getFavs()[+row.dataset.fav];
    if (f) startNavigation({ lat:f.lat, lng:f.lng, name:f.name });
  });
  $('#btn-nav-fav-add').onclick = () => {
    if (me.lat == null){ pushAlert('⚠️ GPS requis', 'warn'); return; }
    const name = prompt('Nom du favori :', 'Maison');
    if (!name) return;
    const a = getFavs(); a.push({ name, lat: me.lat, lng: me.lng }); setFavs(a); renderFavs();
  };
  $('#btn-nav-pick').onclick = () => {
    $('#nav-overlay').classList.add('hidden');
    pushAlert('📍 Touche la carte pour choisir la destination', 'info', 4000);
    if (map) map.once('click', e => startNavigation({ lat:e.lngLat.lat, lng:e.lngLat.lng, name:'Point choisi' }));
  };
  $('#btn-nav-stop').onclick = () => stopNavigation();
  $('#btn-nav-waze').onclick = () => { if (nav) window.open(`https://waze.com/ul?ll=${nav.dest.lat},${nav.dest.lng}&navigate=yes`, '_blank'); };
  $('#btn-nav-maps').onclick = () => { if (nav) window.open(`https://www.google.com/maps/dir/?api=1&destination=${nav.dest.lat},${nav.dest.lng}`, '_blank'); };
  renderFavs();
}

window.FC_NAV = {
  active:  () => !!nav,
  engine:  () => nav ? nav.engine : null,
  mode:    () => nav ? nav.mode : routeMode(),
  points:  () => nav ? nav.coords.length : 0,
  drawn:   () => { const s = map && map.getSource(SRC); return s ? s.serialize().data.geometry.coordinates.length : -1; },
  drawnDriver: () => { const s = driverMap && driverMap.getSource(SRC_D); return s ? s.serialize().data.geometry.coordinates.length : -1; }
};
