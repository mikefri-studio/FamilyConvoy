// ============================================================
// RADARS : chargement CSV + affichage carte + alerte proximité
// Source : https://github.com/mikefri-studio/RadarApp
// Tout est LOCAL : pas de quota Firebase
// ============================================================
import { haversineKm } from './utils.js';
import { S, me } from './state.js';
import { pushAlert, speak } from './notify.js';

const RADAR_CSV_URL = 'https://raw.githubusercontent.com/mikefri-studio/RadarApp/master/app/src/main/assets/radars.csv';
const RADAR_CACHE_KEY = 'fc_radars_cache';
const RADAR_CACHE_TTL = 7 * 86400000; // 7 jours
const RADAR_ALERT_DIST = 0.5;   // km → alerte vocale
const RADAR_MARKER_DIST = 8;    // km → marqueurs DOM

let radars = [];
let radarMarkers = {};
let radarEnabled = localStorage.getItem('fc_radars_enabled') !== 'false';
let alertedRadars = new Set();
let mainMap = null;

// Parse le CSV (séparateur ;)
function parseCSV(text){
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  return lines.slice(1).map(line => {
    const cols = line.split(';');
    if (cols.length < 6) return null;
    const lat = parseFloat(cols[4].replace(',', '.'));
    const lng = parseFloat(cols[5].replace(',', '.'));
    if (isNaN(lat) || isNaN(lng)) return null;
    return {
      id: cols[0].trim(),
      type: cols[1].trim(),
      date: cols[2].trim(),
      vma: parseInt(cols[3]) || null,
      lat, lng,
      isMobile: /mobile|portable|remorqu/i.test(cols[1])
    };
  }).filter(Boolean);
}

// Charge le CSV (cache 7 jours)
export async function loadRadars(){
  const cached = localStorage.getItem(RADAR_CACHE_KEY);
  if (cached){
    const { ts, data } = JSON.parse(cached);
    if (Date.now() - ts < RADAR_CACHE_TTL){
      radars = data;
      console.log('[Radars] chargés depuis cache :', radars.length);
      return;
    }
  }
  try {
    const res = await fetch(RADAR_CSV_URL);
    if (!res.ok) throw new Error('http ' + res.status);
    const text = await res.text();
    radars = parseCSV(text);
    localStorage.setItem(RADAR_CACHE_KEY, JSON.stringify({ ts: Date.now(), data: radars }));
    console.log('[Radars] téléchargés :', radars.length);
  } catch(e){
    console.error('[Radars] erreur chargement :', e.message);
    if (cached) radars = JSON.parse(cached).data;
  }
}

// Radars proches d'un point
function nearbyRadars(lat, lng, radiusKm){
  return radars.filter(r => haversineKm(lat, lng, r.lat, r.lng) <= radiusKm);
}

// Crée l'élément DOM d'un marqueur radar
function makeRadarMarker(r){
  const el = document.createElement('div');
  el.className = 'radar-marker';
  el.textContent = r.isMobile ? '🚨' : '📷';
  el.title = `Radar ${r.type} · ${r.vma ? r.vma + ' km/h' : ''}`;
  return el;
}

// Met à jour les marqueurs visibles
export function updateRadarMarkers(){
  if (!radarEnabled || me.lat == null || !mainMap) return;

  const visible = nearbyRadars(me.lat, me.lng, RADAR_MARKER_DIST);
  const visibleIds = new Set(visible.map(r => r.id));

  // Supprime les anciens hors rayon
  for (const id of Object.keys(radarMarkers)){
    if (!visibleIds.has(id)){
      radarMarkers[id].remove();
      delete radarMarkers[id];
    }
  }

  // Ajoute les nouveaux
  for (const r of visible){
    if (!radarMarkers[r.id]){
      radarMarkers[r.id] = new maplibregl.Marker({ element: makeRadarMarker(r) })
        .setLngLat([r.lng, r.lat])
        .addTo(mainMap);
    }
  }
}

// Alerte vocale + visuelle à l'approche
export function checkRadarAlert(){
  if (!radarEnabled || me.lat == null || !S.joined) return;
  const close = nearbyRadars(me.lat, me.lng, RADAR_ALERT_DIST);
  for (const r of close){
    if (alertedRadars.has(r.id)) continue;
    alertedRadars.add(r.id);
    const type = r.isMobile ? 'mobile' : 'fixe';
    const vma = r.vma ? ` · ${r.vma} km/h` : '';
    const dist = Math.round(haversineKm(me.lat, me.lng, r.lat, r.lng) * 1000);
    const msg = `⚠️ Radar ${type}${vma} à ${dist} mètres`;
    pushAlert(msg, 'warn', 8000);
    speak(`Radar ${type} à ${dist} mètres`);
  }
  // Reset les alertes quand on s'éloigne
  alertedRadars = new Set(
    [...alertedRadars].filter(id => {
      const r = radars.find(x => x.id === id);
      return r && haversineKm(me.lat, me.lng, r.lat, r.lng) < RADAR_ALERT_DIST * 2;
    })
  );
}

// Toggle on/off
export function toggleRadars(){
  radarEnabled = !radarEnabled;
  localStorage.setItem('fc_radars_enabled', radarEnabled);
  if (!radarEnabled){
    for (const m of Object.values(radarMarkers)) m.remove();
    radarMarkers = {};
    alertedRadars.clear();
  }
  return radarEnabled;
}
export function isRadarsEnabled(){ return radarEnabled; }

// Expose la carte principale
export function setMainMap(map){
  mainMap = map;
}
