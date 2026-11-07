// ============================================================
// MAP : les 3 cartes, switcher, marqueurs, tracés, replay
// ============================================================
import { MAP_STYLES, STYLE_LABELS } from './config.js';
import { S, me, getAll } from './state.js';
import { $, haversineKm, ago, bus } from './utils.js';
import { pushAlert } from './notify.js';
import { applyAvatarToEl } from './avatar.js';
import { setMainMap, initRadarLayer } from './radars.js';

export let map = null, driverMap = null, replayMap = null;
let replayMarker = null, replayRAF = null, replayPts = [];

function injectTrailsLayer(m, sourceName, layerName){
  if (!m.getSource(sourceName)) {
    m.addSource(sourceName, { type:'geojson', data:{ type:'FeatureCollection', features:[] } });
    m.addLayer({ id:layerName, type:'line', source:sourceName,
      paint:{ 'line-width':3, 'line-opacity':0.7, 'line-color':['get','color'] } });
  }
}

export function initMaps(){
  map = new maplibregl.Map({ container:'map', style: MAP_STYLES[S.currentStyle], center:[2.35,48.85], zoom:5 });
  map.addControl(new maplibregl.NavigationControl({showCompass:false}),'bottom-right');
  setMainMap(map);

  map.on('load', () => {
    injectTrailsLayer(map, 'trails', 'trail-lines');
    initRadarLayer(); 
    bus.emit('render');
  });

  // 🚀 CORRECTION : Écoute du changement de style pour la carte principale
  // Déclenché à chaque fois que l'utilisateur change de fond de carte
  map.on('style.load', () => {
    injectTrailsLayer(map, 'trails', 'trail-lines');
    initRadarLayer(); 
    bus.emit('render'); // Redessine les marqueurs HTML des membres
  });
  
  map.on('dragstart', () => { if (S.followId) { S.followId = null; bus.emit('follow-stop'); } });

  document.querySelectorAll('.sw-btn').forEach(btn => {
    btn.addEventListener('click', () => changeMapStyle(btn.dataset.style));
    if (btn.dataset.style === S.currentStyle) btn.classList.add('active');
  });
}

export function changeMapStyle(styleKey){
  if (!MAP_STYLES[styleKey]) return;
  S.currentStyle = styleKey;
  localStorage.setItem('fc_mapStyle', styleKey);
  document.querySelectorAll('.sw-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.style === styleKey));
  
  // Le setStyle va déclencher les événements 'style.load' sur chaque carte
  [map, driverMap, replayMap].forEach(m => { if (m) m.setStyle(MAP_STYLES[styleKey]); });
  pushAlert(`🗺️ Carte ${STYLE_LABELS[styleKey]}`, 'info', 1800);
}

function makeMarkerEl(id, v){
  const el = document.createElement('div');
  el.className = 'marker' + (id===me.id?' me':'') + (S.hidden && id===me.id?' ghost':'');
  el.style.background = v.color || '#7b1fa2';
  applyAvatarToEl(el, id, v);
  return el;
}

export function updateMapVisuals(all){
  for (const [id, v] of Object.entries(all)) {
    if (v.lat == null) continue;
    if (!S.markersMain[id]) {
      S.markersMain[id] = new maplibregl.Marker({element: makeMarkerEl(id, v)})
        .setLngLat([v.lng, v.lat]).addTo(map);
      S.markersMain[id].getElement().onclick = () => bus.emit('follow-toggle', id);
    } else S.markersMain[id].setLngLat([v.lng, v.lat]);
    const elM = S.markersMain[id].getElement();
    applyAvatarToEl(elM, id, v);
    elM.classList.toggle('followed', id === S.followId);
    S.markersMain[id].setPopup(new maplibregl.Popup({offset:25}).setHTML(
      `<b>${v.name}</b><br>${v.speed?`🚀 ${v.speed} km/h<br>`:''}${v.battery!=null?`🔋 ${v.battery}%<br>`:''}${v.devCount>1?`📱×${v.devCount}<br>`:''}il y a ${ago(v.lastSeen||v.updatedAt||Date.now())}`));
    if (driverMap) {
      if (!S.markersDriver[id]) {
        S.markersDriver[id] = new maplibregl.Marker({element: makeMarkerEl(id, v)})
          .setLngLat([v.lng, v.lat]).addTo(driverMap);
      } else S.markersDriver[id].setLngLat([v.lng, v.lat]);
    }
  }
  for (const id of Object.keys(S.markersMain)) if (!all[id] || all[id].lat==null){ S.markersMain[id].remove(); delete S.markersMain[id]; }
  for (const id of Object.keys(S.markersDriver)) if (!all[id] || all[id].lat==null){ S.markersDriver[id].remove(); delete S.markersDriver[id]; }

  for (const [id, v] of Object.entries(all)) {
    if (v.lat == null) continue;
    if (!S.trails[id]) S.trails[id] = [];
    const last = S.trails[id][S.trails[id].length-1];
    if (!last || haversineKm(last[1],last[0],v.lat,v.lng)*1000 > 30) {
      S.trails[id].push([v.lng, v.lat]);
      if (S.trails[id].length > 80) S.trails[id].shift();
    }
  }
  const trailFC = {
    type:'FeatureCollection',
    features: Object.entries(S.trails).map(([id,pts]) => ({
      type:'Feature', properties:{ color: all[id]?.color || '#888' },
      geometry:{ type:'LineString', coordinates: pts }
    }))
  };
  if (map.getSource('trails')) map.getSource('trails').setData(trailFC);
  if (driverMap && driverMap.getSource('trails-d')) driverMap.getSource('trails-d').setData(trailFC);

  if (!S.boundsDone && Object.keys(all).length){
    const b = new maplibregl.LngLatBounds();
    Object.values(all).forEach(v => v.lat!=null && b.extend([v.lng, v.lat]));
    map.fitBounds(b, {padding:60, maxZoom:12}); S.boundsDone = true;
  }
  if (S.driverMode && S.followMe && me.lat!=null && driverMap) {
    driverMap.easeTo({ center:[me.lng, me.lat], zoom:15, duration:1500 });
  }
  if (!S.driverMode && S.followId && all[S.followId] && all[S.followId].lat != null) {
    map.easeTo({ center:[all[S.followId].lng, all[S.followId].lat], duration:1200 });
  }
}

export function initDriverMap(){
  if (!driverMap) {
    driverMap = new maplibregl.Map({
      container:'driver-map', style: MAP_STYLES[S.currentStyle],
      center:[me.lng||2.35, me.lat||48.85], zoom:15, pitch:45
    });
    driverMap.addControl(new maplibregl.NavigationControl({showCompass:false}),'bottom-right');
    driverMap.on('dragstart', ()=> S.followMe=false);
    
    // 🚀 CORRECTION : Écoute du changement de style pour la carte conducteur
    driverMap.on('style.load', () => {
        injectTrailsLayer(driverMap, 'trails-d', 'trail-lines-d');
        bus.emit('render'); 
    });
    driverMap.on('load', () => {
        injectTrailsLayer(driverMap, 'trails-d', 'trail-lines-d');
    });
  } else setTimeout(()=> driverMap.resize(), 50);
}

function setReplayLine(coords){
  if (replayMap && replayMap.getSource('replay-line'))
    replayMap.getSource('replay-line').setData({ type:'Feature', geometry:{ type:'LineString', coordinates:coords } });
}
function prepareReplay(){
  if (!replayMap) return;
  setReplayLine(replayPts);
  if (replayPts.length) {
    if (!replayMarker) {
      const el = document.createElement('div');
      el.className = 'marker'; el.style.background = '#1a73e8'; el.textContent = '🚗';
      replayMarker = new maplibregl.Marker({element:el}).addTo(replayMap);
    }
    replayMarker.setLngLat(replayPts[0]);
    const b = new maplibregl.LngLatBounds();
    replayPts.forEach(p=>b.extend(p));
    replayMap.fitBounds(b, {padding:50, maxZoom:16});
  }
}

export function playReplay(){
  if (!replayMap || !replayMap.getSource('replay-line') || replayPts.length < 2) return;
  cancelAnimationFrame(replayRAF);
  const dur = Math.min(12000, Math.max(5000, replayPts.length*40));
  const t0 = performance.now();
  const step = now => {
    const k = Math.min(1, (now-t0)/dur);
    const idx = Math.max(1, Math.floor(k*replayPts.length));
    setReplayLine(replayPts.slice(0, idx));
    if (replayMarker) replayMarker.setLngLat(replayPts[idx-1]);
    if (k < 1) replayRAF = requestAnimationFrame(step);
  };
  replayRAF = requestAnimationFrame(step);
}

export function openReplay(item, pts){
  replayPts = pts;
  const avg = item.min>0 ? Math.round(item.km/(item.min/60)) : '—';
  $('#replay-title').textContent = `📊 ${new Date(item.start).toLocaleDateString('fr-FR')} — ${item.name||'?'}`;
  $('#replay-stats').textContent = `${item.km} km · ${item.min} min · Ø ${avg} km/h · ${pts.length} pts`;
  $('#history-overlay').classList.add('hidden');
  $('#replay-overlay').classList.remove('hidden');
  
  if (!replayMap) {
    replayMap = new maplibregl.Map({ container:'replay-map', style: MAP_STYLES[S.currentStyle], center:[2.35,48.85], zoom:5 });
    
    // 🚀 CORRECTION : Écoute du changement de style pour la carte de replay
    replayMap.on('style.load', () => {
      if (!replayMap.getSource('replay-line')) {
        replayMap.addSource('replay-line', { type:'geojson', data:{ type:'Feature', geometry:{ type:'LineString', coordinates:replayPts } } });
        replayMap.addLayer({ id:'replay-line-layer', type:'line', source:'replay-line',
          paint:{ 'line-width':4, 'line-color':'#1a73e8', 'line-opacity':0.85 } });
      } else {
        replayMap.getSource('replay-line').setData({ type:'Feature', geometry:{ type:'LineString', coordinates:replayPts } });
      }
      prepareReplay(); 
    });
  } else {
      setTimeout(()=>{ 
          replayMap.resize(); 
          prepareReplay(); 
          playReplay(); 
      }, 60);
  }
}

export function closeReplay(){
  cancelAnimationFrame(replayRAF);
  $('#replay-overlay').classList.add('hidden');
}
