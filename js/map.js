// ============================================================
// MAP : carte principale + carte conduite (caméra cap optionnelle),
//       marqueurs, traces, styles, replay
// ============================================================
import { MAP_STYLES } from './config.js';
import { $, haversineKm, colorFor, bus } from './utils.js';
import { S, me } from './state.js';
import { setMainMap, setDriverMap, initRadarLayer } from './radars.js';
import { applyAvatarToEl } from './avatar.js';

export let map = null;
export let driverMap = null;

let replayMap = null, replayMarker = null, replayTimer = null, replayPts = [];
let lastBearing = 0;

const styleUrl = () => MAP_STYLES[S.currentStyle] || MAP_STYLES.standard;
const loaded = m => !!(m && m.isStyleLoaded && m.isStyleLoaded());

// ---------- Traces ----------
function trailFC(){
  const features = [];
  for (const [id, pts] of Object.entries(S.trails)){
    if (pts.length > 1) features.push({
      type:'Feature', properties:{ color: colorFor(id) },
      geometry:{ type:'LineString', coordinates: pts }
    });
  }
  return { type:'FeatureCollection', features };
}
function ensureTrails(m){
  if (!loaded(m) || m.getSource('trails')) return;
  m.addSource('trails', { type:'geojson', data: trailFC() });
  m.addLayer({ id:'trails-line', type:'line', source:'trails',
    layout:{ 'line-cap':'round', 'line-join':'round' },
    paint:{ 'line-color':['get','color'], 'line-width':3, 'line-opacity':0.5 } });
}
function syncTrails(m){
  if (!m) return;
  const s = m.getSource('trails');
  if (s) s.setData(trailFC());
}

// ---------- Marqueurs ----------
function syncMarkers(store, m, all){
  if (!m) return;
  for (const id of Object.keys(store)){
    if (!all[id]){ store[id].remove(); delete store[id]; }
  }
  for (const [id, v] of Object.entries(all)){
    if (v.lat == null) continue;
    let mk = store[id];
    if (!mk){
      const el = document.createElement('div');
      el.className = 'marker';
      el.addEventListener('click', () => bus.emit('follow-toggle', id));
      mk = new maplibregl.Marker({ element: el, anchor:'center' }).setLngLat([v.lng, v.lat]).addTo(m);
      store[id] = mk;
    } else mk.setLngLat([v.lng, v.lat]);
    const el = mk.getElement();
    el.classList.toggle('me', id === me.id);
    el.classList.toggle('followed', id === S.followId);
    el.classList.toggle('ghost', !!v.hidden);
    applyAvatarToEl(el, id, v);
  }
}

// ---------- Rendu + caméras ----------
export function updateMapVisuals(all){
  for (const [id, v] of Object.entries(all)){
    if (v.lat == null) continue;
    const t = S.trails[id] || (S.trails[id] = []);
    const last = t[t.length - 1];
    if (!last || haversineKm(last[1], last[0], v.lat, v.lng) * 1000 > 15){
      t.push([v.lng, v.lat]);
      if (t.length > 400) t.shift();
    }
  }
  syncMarkers(S.markersMain, map, all);
  syncMarkers(S.markersDriver, driverMap, all);
  ensureTrails(map); syncTrails(map);
  ensureTrails(driverMap); syncTrails(driverMap);

  if (map && S.followId){
    const v = all[S.followId];
    if (v && v.lat != null) map.easeTo({ center:[v.lng, v.lat], duration:1200 });
  }
  if (driverMap && S.driverMode && S.followMe && me.lat != null){
    if ((me.speed || 0) > 5 && S.myHeading != null) lastBearing = S.myHeading;
    const headingOn = localStorage.getItem('fc_driver_heading') === '1';
    driverMap.easeTo({
      center:[me.lng, me.lat], zoom:15, pitch:45,
      bearing: headingOn ? lastBearing : 0, duration:1200
    });
  }
}

// ---------- Styles ----------
export function changeStyle(key){
  if (!MAP_STYLES[key]) return;
  S.currentStyle = key;
  localStorage.setItem('fc_mapStyle', key);
  document.querySelectorAll('.sw-btn').forEach(b => b.classList.toggle('active', b.dataset.style === key));
  if (map) map.setStyle(styleUrl());
  if (driverMap) driverMap.setStyle(styleUrl());
}

// ---------- Init ----------
export function initMaps(){
  map = new maplibregl.Map({
    container:'map', style: styleUrl(), center:[2.4, 46.6], zoom:6, attributionControl:false
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass:false }), 'bottom-right');
  map.addControl(new maplibregl.AttributionControl({ compact:true }), 'bottom-right');
  setMainMap(map);
  map.on('style.load', () => { initRadarLayer(); ensureTrails(map); syncTrails(map); });
  document.querySelectorAll('.sw-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.style === S.currentStyle);
    b.addEventListener('click', () => changeStyle(b.dataset.style));
  });
}

export function initDriverMap(){
  if (driverMap){ setTimeout(() => driverMap.resize(), 60); return; }
  driverMap = new maplibregl.Map({
    container:'driver-map', style: styleUrl(),
    center: me.lat != null ? [me.lng, me.lat] : [2.4, 46.6],
    zoom:15, pitch:45, attributionControl:false
  });
  setDriverMap(driverMap);
  driverMap.on('style.load', () => { initRadarLayer(); ensureTrails(driverMap); syncTrails(driverMap); });
  driverMap.on('dragstart', () => { S.followMe = false; });
  driverMap.on('load', () => driverMap.resize());
}

// ---------- Replay ----------
function stopReplayTimer(){ if (replayTimer){ clearInterval(replayTimer); replayTimer = null; } }
export function openReplay(item, pts){
  $('#replay-title').textContent = `📊 ${item.name || 'Trajet'} · ${new Date(item.start).toLocaleDateString('fr-FR')}`;
  $('#replay-stats').textContent = `${item.km} km · ${item.min} min`;
  $('#replay-overlay').classList.remove('hidden');
  replayPts = pts || [];
  stopReplayTimer();
  if (replayMap){ replayMap.remove(); replayMap = null; replayMarker = null; }
  replayMap = new maplibregl.Map({
    container:'replay-map', style: styleUrl(),
    center: replayPts.length ? replayPts[0] : [2.4, 46.6], zoom:12, attributionControl:false
  });
  replayMap.on('load', () => {
    if (replayPts.length > 1){
      replayMap.addSource('replay', { type:'geojson', data:{ type:'Feature', geometry:{ type:'LineString', coordinates: replayPts } } });
      replayMap.addLayer({ id:'replay-line', type:'line', source:'replay',
        layout:{ 'line-cap':'round' }, paint:{ 'line-color':'#1a73e8', 'line-width':5 } });
      const b = new maplibregl.LngLatBounds();
      replayPts.forEach(p => b.extend(p));
      replayMap.fitBounds(b, { padding:40, duration:0 });
    }
    replayMarker = new maplibregl.Marker({ color:'#e53935' })
      .setLngLat(replayPts[0] || [2.4, 46.6]).addTo(replayMap);
  });
}
export function playReplay(){
  if (!replayMap || replayPts.length < 2 || !replayMarker) return;
  stopReplayTimer();
  let i = 0;
  replayTimer = setInterval(() => {
    i++;
    if (i >= replayPts.length){ stopReplayTimer(); return; }
    replayMarker.setLngLat(replayPts[i]);
    replayMap.panTo(replayPts[i], { duration:200 });
  }, 220);
}
export function closeReplay(){
  stopReplayTimer();
  $('#replay-overlay').classList.add('hidden');
  if (replayMap){ replayMap.remove(); replayMap = null; replayMarker = null; }
}
