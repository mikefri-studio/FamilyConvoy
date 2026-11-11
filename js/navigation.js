// ============================================================
// NAVIGATION v2 : guidage turn-by-turn (Valhalla FR + OSRM secours)
// + tracé bleu AUTO-RÉPARANT sur les 2 cartes + aperçu itinéraire
// + recherche Nominatim + membre/carte/favori + voix + Waze/Maps
// ============================================================
import { map, driverMap } from './map.js';
import { S, me, getAll } from './state.js';
import { $, haversineKm } from './utils.js';
import { pushAlert, speak } from './notify.js';

const VALHALLA  = 'https://valhalla1.openstreetmap.de/route';
const OSRM      = 'https://router.project-osrm.org/route/v1/driving/';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const FAV_KEY   = 'fc_nav_favs';

const SRC='nav-route', CASING='nav-route-casing', LINE='nav-route-line';
const SRC_D='nav-route-d', CASING_D='nav-route-casing-d', LINE_D='nav-route-line-d';

let nav = null;
let searchTimer = null;
const hooked = new WeakSet();

// ---------- Utilitaires géo ----------
function decodePolyline(str, precision = 6){
  let index = 0, lat = 0, lng = 0, coords = [], shift = 0, result = 0, byte = null;
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
  return coords;
}
function buildCum(coords){
  const cum = [0];
  for (let i = 1; i < coords.length; i++)
    cum.push(cum[i-1] + haversineKm(coords[i-1][1], coords[i-1][0], coords[i][1], coords[i][0]));
  return cum;
}
const fmtDist = m => m < 1000 ? `${Math.round(m/10)*10} m` : `${(m/1000).toFixed(1)} km`;

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

// ---------- Itinéraires ----------
async function routeValhalla(from, to){
  const r = await fetch(VALHALLA, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      locations: [{ lat: from.lat, lon: from.lng }, { lat: to.lat, lon: to.lng }],
      costing: 'auto',
      directions_options: { language: 'fr-FR', units: 'kilometers' }
    })
  });
  if (!r.ok) throw new Error('valhalla ' + r.status);
  const j = await r.json();
  const leg = j.trip && j.trip.legs && j.trip.legs[0];
  if (!leg) throw new Error('no leg');
  return {
    coords: decodePolyline(leg.shape, 6),
    maneuvers: (leg.maneuvers || []).map(m => ({
      begin: m.begin_shape_index || 0, end: m.end_shape_index || 0,
      text: m.instruction || '', type: m.type || 0, time: m.time || 0
    })),
    summary: { km: j.trip.summary.length, min: j.trip.summary.time / 60 }
  };
}
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
    case 'fork': base = 'Au fork, ' + dir; break;
    case 'roundabout': case 'rotary': base = 'Au rond-point, sortie ' + (m.exit || ''); break;
    case 'end of road': base = 'Au bout, ' + dir; break;
    default: base = 'Continuez ' + dir;
  }
  return name ? base + ' sur ' + name : base;
}
async function routeOSRM(from, to){
  const r = await fetch(`${OSRM}${from.lng},${from.lat};${to.lng},${to.lat}?steps=true&geometries=geojson&overview=full`);
  if (!r.ok) throw new Error('osrm ' + r.status);
  const j = await r.json();
  const rt = j.routes && j.routes[0];
  if (!rt) throw new Error('no route');
  const coords = rt.geometry.coordinates;
  let idx = 0; const maneuvers = [];
  for (const leg of rt.legs || []) for (const st of leg.steps || []) {
    const n = (st.geometry && st.geometry.coordinates) ? st.geometry.coordinates.length : 1;
    const begin = idx, end = Math.min(coords.length - 1, idx + n - 1);
    maneuvers.push({ begin, end, text: osrmText(st), type: osrmType(st), time: st.duration || 0 });
    idx = end;
  }
  return { coords, maneuvers, summary: { km: rt.distance / 1000, min: rt.duration / 60 } };
}

// ---------- Couche tracé : AUTO-RÉPARATION sur les 2 cartes ----------
function ensureOn(m, src, casing, line){
  if (!m) return;
  if (!hooked.has(m)){
    hooked.add(m);
    const re = () => { if (nav){ ensureOn(m, src, casing, line); paint(m, src); } };
    m.on('style.load', re);
    m.on('load', re);
  }
  try {
    if (!m.getSource(src))
      m.addSource(src, { type:'geojson', data:{ type:'Feature', geometry:{ type:'LineString', coordinates:[] } } });
    if (!m.getLayer(casing))
      m.addLayer({ id:casing, type:'line', source:src,
        layout:{ 'line-cap':'round', 'line-join':'round' },
        paint:{ 'line-color':'#0d47a1', 'line-width':9, 'line-opacity':0.9 } });
    if (!m.getLayer(line))
      m.addLayer({ id:line, type:'line', source:src,
        layout:{ 'line-cap':'round', 'line-join':'round' },
        paint:{ 'line-color':'#42a5f5', 'line-width':5, 'line-opacity':0.95 } });
  } catch(e){ console.warn('[Nav] couche :', e.message); }
}
function paint(m, src){
  if (!m || !nav || !nav.coords || nav.coords.length < 2) return;
  const s = m.getSource(src);
  if (s) s.setData({ type:'Feature', geometry:{ type:'LineString', coordinates: nav.coords } });
}
function ensureLayer(){
  ensureOn(map, SRC, CASING, LINE);
  ensureOn(driverMap, SRC_D, CASING_D, LINE_D);
}
function drawRoute(){
  paint(map, SRC);
  paint(driverMap, SRC_D);
  if (map) map.triggerRepaint();
  if (driverMap) driverMap.triggerRepaint();
}
function clearRoute(){
  for (const [m, src] of [[map, SRC], [driverMap, SRC_D]]){
    if (m && m.getSource(src))
      m.getSource(src).setData({ type:'Feature', geometry:{ type:'LineString', coordinates:[] } });
  }
}
function overview(){
  if (!nav || nav.coords.length < 2) return;
  const b = new maplibregl.LngLatBounds();
  nav.coords.forEach(p => b.extend(p));
  if (map) map.fitBounds(b, { padding:70, maxZoom:15, duration:800 });
  if (driverMap) driverMap.fitBounds(b, { padding:70, maxZoom:15, duration:800 });
  nav.overviewUntil = Date.now() + 6000; // 6 s pour voir tout le tracé
}

// ---------- Drapeau destination ----------
function flagEl(){
  const el = document.createElement('div');
  el.className = 'marker'; el.textContent = '🏁'; el.style.fontSize = '30px';
  return el;
}
function ensureDestMarkers(){
  if (!nav) return;
  if (map && !nav.destMarker) nav.destMarker = new maplibregl.Marker({ element: flagEl() }).addTo(map);
  if (driverMap && !nav.destMarkerD) nav.destMarkerD = new maplibregl.Marker({ element: flagEl() }).addTo(driverMap);
  if (nav.destMarker) nav.destMarker.setLngLat([nav.dest.lng, nav.dest.lat]);
  if (nav.destMarkerD) nav.destMarkerD.setLngLat([nav.dest.lng, nav.dest.lat]);
}

// ---------- Bandeau ----------
function setBanner(icon, instr, dist, eta){
  $('#nav-icon').textContent = icon;
  $('#nav-instr').textContent = instr;
  $('#nav-dist').textContent = dist;
  $('#nav-eta').textContent = eta;
}
function etaText(remainKm){
  if (!nav || !nav.summary || !nav.summary.km || !nav.summary.min) return '';
  const speed = nav.summary.km / nav.summary.min;
  return `${remainKm.toFixed(1)} km · ${Math.max(1, Math.round(remainKm / speed))} min`;
}

// ---------- Cœur ----------
function memberPos(){
  const v = getAll()[nav.memberId];
  return (v && v.lat != null) ? { lat: v.lat, lng: v.lng, name: v.name } : null;
}
async function computeRoute(){
  if (!nav || nav.computing) return;
  nav.computing = true;
  const to = nav.memberId ? memberPos() : nav.dest;
  if (!to){ pushAlert('📵 Destination indisponible', 'warn'); stopNavigation(); return; }
  nav.dest.lat = to.lat; nav.dest.lng = to.lng;
  let r = null;
  try { r = await routeValhalla({ lat: me.lat, lng: me.lng }, to); }
  catch(e){ try { r = await routeOSRM({ lat: me.lat, lng: me.lng }, to); } catch(e2){ r = null; } }
  nav.computing = false;
  if (!nav) return;
  if (!r || !r.coords || r.coords.length < 2){ pushAlert('❌ Itinéraire introuvable', 'warn'); stopNavigation(); return; }
  nav.coords = r.coords; nav.cum = buildCum(r.coords);
  nav.total = nav.cum[nav.cum.length - 1];
  nav.maneuvers = r.maneuvers; nav.summary = r.summary;
  nav.idx = 0; nav.announced = new Set();
  ensureLayer(); drawRoute(); ensureDestMarkers(); overview(); updateBanner();
  console.log('[Nav] itinéraire :', nav.coords.length, 'points,', nav.total.toFixed(2), 'km');
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
function nextManeuver(){
  return nav.maneuvers.find(m => m.begin >= nav.idx && m.type !== 1)
      || nav.maneuvers[nav.maneuvers.length - 1];
}
function announce(nm, dToMan){
  for (const th of [300, 100]){
    const key = nm.begin + ':' + th;
    if (dToMan <= th && !nav.announced.has(key)){
      nav.announced.add(key);
      speak(`Dans ${Math.round(dToMan/10)*10} mètres, ${nm.text}`);
    }
  }
  const keyNow = nm.begin + ':now';
  if (dToMan < 25 && !nav.announced.has(keyNow)){
    nav.announced.add(keyNow);
    speak(nm.text);
  }
}
function updateBanner(){
  const remainKm = Math.max(0, nav.total - nav.cum[nav.idx]);
  const nm = nextManeuver();
  if (nm){
    const dToMan = Math.max(0, nav.cum[nm.begin] - nav.cum[nav.idx]) * 1000;
    setBanner(iconFor(nm.type), nm.text, 'dans ' + fmtDist(dToMan), etaText(remainKm));
  } else setBanner('⬆', 'Continuez', '', etaText(remainKm));
}
function arrive(){
  speak('Vous êtes arrivé à destination');
  pushAlert('🏁 Arrivé à destination', 'success', 5000);
  stopNavigation(true);
}

export function navigationTick(){
  if (!nav || me.lat == null || !map) return;
  // 🛡️ AUTO-RÉPARATION : couche + tracé vérifiés à chaque tick
  ensureLayer(); drawRoute(); ensureDestMarkers();

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
  const dDest = haversineKm(me.lat, me.lng, nav.dest.lat, nav.dest.lng);
  if (dDest < 0.04){ arrive(); return; }
  const off = haversineKm(me.lat, me.lng, nav.coords[nav.idx][1], nav.coords[nav.idx][0]);
  if (off > 0.06 && Date.now() - nav.lastReroute > 20000){
    nav.lastReroute = Date.now();
    pushAlert('🔁 Recalcul de l’itinéraire', 'info', 2500);
    computeRoute(); return;
  }
  const nm = nextManeuver();
  if (nm) announce(nm, Math.max(0, nav.cum[nm.begin] - nav.cum[nav.idx]) * 1000);
  updateBanner();

  // Caméra : seulement après l'aperçu de 6 s
  if (Date.now() < (nav.overviewUntil || 0)) return;
  const bearing = S.myHeading != null ? S.myHeading : 0;
  if (S.driverMode && driverMap) driverMap.easeTo({ center:[me.lng, me.lat], zoom:16, bearing, pitch:50, duration:900 });
  else map.easeTo({ center:[me.lng, me.lat], zoom:16, bearing, pitch:45, duration:900 });
}

export async function startNavigation(dest){
  if (me.lat == null){ pushAlert('⚠️ GPS requis pour naviguer', 'warn'); return; }
  stopNavigation(true);
  nav = { dest:{ ...dest }, memberId: dest.memberId || null, coords:[], cum:[], total:0,
          maneuvers:[], idx:0, announced:new Set(), lastReroute:0, lastMemberRefresh:0,
          computing:false, destMarker:null, destMarkerD:null, summary:null, overviewUntil:0 };
  S.followId = null; S.followMe = false;
  $('#btn-nav').classList.add('active');
  $('#nav-banner').classList.remove('hidden');
  $('#nav-overlay').classList.add('hidden');
  setBanner('⏳', 'Calcul de l’itinéraire…', '', '');
  await computeRoute();
  if (nav) speak('Navigation démarrée vers ' + nav.dest.name);
}
export function stopNavigation(silent){
  if (nav){
    if (nav.destMarker) nav.destMarker.remove();
    if (nav.destMarkerD) nav.destMarkerD.remove();
  }
  nav = null;
  clearRoute();
  $('#nav-banner').classList.add('hidden');
  $('#btn-nav').classList.remove('active');
  S.followMe = true;
  if (!silent) pushAlert('🧭 Navigation arrêtée', 'info', 2000);
}
export function isNavigating(){ return !!nav; }

// ---------- Favoris ----------
const getFavs = () => { try { return JSON.parse(localStorage.getItem(FAV_KEY) || '[]'); } catch(e){ return []; } };
const setFavs = f => localStorage.setItem(FAV_KEY, JSON.stringify(f));
function addFav(f){ const a = getFavs(); a.push(f); setFavs(a); }
function removeFav(i){ const a = getFavs(); a.splice(i, 1); setFavs(a); }

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
    const r = await fetch(`${NOMINATIM}?format=json&q=${encodeURIComponent(q)}&limit=5&accept-language=fr`);
    const j = await r.json();
    box.innerHTML = j.length ? j.map(x =>
      `<div class="nav-item" data-lat="${x.lat}" data-lng="${x.lon}" data-name="${(x.display_name||'').replace(/"/g,'&quot;')}">📍 ${(x.display_name||'').slice(0,60)}</div>`).join('')
      : '<div class="nav-empty">Aucun résultat</div>';
  } catch(e){ box.innerHTML = '<div class="nav-empty">Erreur de recherche</div>'; }
}
export function openNavOverlay(){
  renderMembers(); renderFavs();
  $('#nav-search').value = ''; $('#nav-results').innerHTML = '';
  $('#nav-overlay').classList.remove('hidden');
}

// ---------- Bindings ----------
export function bindNavigationUI(){
  $('#btn-nav').onclick = () => { if (nav) stopNavigation(); else openNavOverlay(); };
  $('#btn-close-nav').onclick = () => $('#nav-overlay').classList.add('hidden');
  $('#nav-search').addEventListener('input', e => {
    clearTimeout(searchTimer);
    const q = e.target.value.trim();
    searchTimer = setTimeout(() => search(q), 500);
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
    if (del){ removeFav(+del.dataset.favDel); renderFavs(); return; }
    const row = e.target.closest('[data-fav]'); if (!row) return;
    const f = getFavs()[+row.dataset.fav];
    if (f) startNavigation({ lat:f.lat, lng:f.lng, name:f.name });
  });
  $('#btn-nav-fav-add').onclick = () => {
    if (me.lat == null){ pushAlert('⚠️ GPS requis', 'warn'); return; }
    const name = prompt('Nom du favori :', 'Maison');
    if (!name) return;
    addFav({ name, lat: me.lat, lng: me.lng }); renderFavs();
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

// ---------- 🔍 Debug console (F12) ----------
window.FC_NAV = {
  active:    () => !!nav,
  points:    () => nav ? nav.coords.length : 0,
  hasSource: () => !!(map && map.getSource(SRC)),
  hasLayer:  () => !!(map && map.getLayer(LINE)),
  drawn:     () => { const s = map && map.getSource(SRC); return s ? s.serialize().data.geometry.coordinates.length : -1; },
  redraw:    () => { ensureLayer(); drawRoute(); }
};
