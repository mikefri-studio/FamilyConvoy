// ============================================================
// RADARS v2 : GeoJSON performant + menu de réglages complet
// ============================================================
import { haversineKm } from './utils.js';
import { S, me } from './state.js';
import { pushAlert, speak } from './notify.js';

const RADAR_CSV_URL = 'https://raw.githubusercontent.com/mikefri-studio/RadarApp/master/app/src/main/assets/radars.csv';
const RADAR_CACHE_KEY = 'fc_radars_cache';
const RADAR_CACHE_TTL = 7 * 86400000;
const RADAR_SETTINGS_KEY = 'fc_radar_settings';

// Réglages par défaut
const DEFAULT_SETTINGS = {
  displayRadius: 25,      // km (5, 10, 25, 50, 100, 0=tous)
  alertDist: 0.5,         // km (0.2, 0.5, 1, 2)
  showFixed: true,        // radars fixes
  showMobile: true,       // radars mobiles
  alertSound: 'voice',    // 'voice', 'beep', 'both', 'silent'
  minSpeed: 30,           // km/h (0, 30, 50, 70, 90)
  showVMA: true,          // afficher la VMA dans le popup
  enabled: true           // radars activés
};

let radars = [];
let radarGeoJSON = null;
let settings = { ...DEFAULT_SETTINGS };
let alertedRadars = new Set();
let mainMap = null;
let lastBeepTime = 0;

// Charger les réglages
function loadSettings(){
  try {
    const saved = localStorage.getItem(RADAR_SETTINGS_KEY);
    if (saved) settings = { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
  } catch(e){}
}
export function getSettings(){ return settings; }
export function saveSettings(newSettings){
  settings = { ...settings, ...newSettings };
  localStorage.setItem(RADAR_SETTINGS_KEY, JSON.stringify(settings));
  updateRadarLayer(); // rafraîchit l'affichage
}

// Parse le CSV
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
      isMobile: /mobile|portable|remorqu|feux/i.test(cols[1])
    };
  }).filter(Boolean);
}

// Charger le CSV
export async function loadRadars(){
  loadSettings();
  const cached = localStorage.getItem(RADAR_CACHE_KEY);
  if (cached){
    const { ts, data } = JSON.parse(cached);
    if (Date.now() - ts < RADAR_CACHE_TTL){
      radars = data;
      buildGeoJSON();
      console.log('[Radars] cache :', radars.length);
      return;
    }
  }
  try {
    const res = await fetch(RADAR_CSV_URL);
    if (!res.ok) throw new Error('http ' + res.status);
    const text = await res.text();
    radars = parseCSV(text);
    localStorage.setItem(RADAR_CACHE_KEY, JSON.stringify({ ts: Date.now(), data: radars }));
    buildGeoJSON();
    console.log('[Radars] téléchargés :', radars.length);
  } catch(e){
    console.error('[Radars] erreur :', e.message);
    if (cached) { radars = JSON.parse(cached).data; buildGeoJSON(); }
  }
}

// Construit le GeoJSON une seule fois
function buildGeoJSON(){
  radarGeoJSON = {
    type: 'FeatureCollection',
    features: radars.map(r => ({
      type: 'Feature',
      properties: {
        id: r.id,
        type: r.type,
        vma: r.vma,
        date: r.date,
        isMobile: r.isMobile ? 1 : 0
      },
      geometry: { type: 'Point', coordinates: [r.lng, r.lat] }
    }))
  };
}

// Expose la carte
export function setMainMap(map){ mainMap = map; }

// Filtre les radars selon les réglages
function getFilteredRadars(){
  if (!radars.length) return [];
  return radars.filter(r => {
    if (r.isMobile && !settings.showMobile) return false;
    if (!r.isMobile && !settings.showFixed) return false;
    if (settings.displayRadius > 0 && me.lat != null){
      if (haversineKm(me.lat, me.lng, r.lat, r.lng) > settings.displayRadius) return false;
    }
    return true;
  });
}

// Met à jour la couche GeoJSON sur la carte
export function updateRadarLayer(){
  if (!mainMap || !radarGeoJSON) return;
  const source = mainMap.getSource('radars');
  if (!source) return;

  const filtered = getFilteredRadars();
  const fc = {
    type: 'FeatureCollection',
    features: radarGeoJSON.features.filter(f => filtered.some(r => r.id === f.properties.id))
  };
  source.setData(fc);

  // Met à jour le filtre du layer (couleur selon type)
  if (mainMap.getLayer('radar-circles')){
    mainMap.setPaintProperty('radar-circles', 'circle-color', [
      'case', ['==', ['get', 'isMobile'], 1], '#ff5252', '#ff9800'
    ]);
  }
}

// Alerte vocale + visuelle
export function checkRadarAlert(){
  if (!settings.enabled || me.lat == null || !S.joined) return;
  if (me.speed < settings.minSpeed) return; // ne pas alerter si trop lent

  const close = radars.filter(r => {
    if (r.isMobile && !settings.showMobile) return false;
    if (!r.isMobile && !settings.showFixed) return false;
    return haversineKm(me.lat, me.lng, r.lat, r.lng) <= settings.alertDist;
  });

  for (const r of close){
    if (alertedRadars.has(r.id)) continue;
    alertedRadars.add(r.id);
    const type = r.isMobile ? 'mobile' : 'fixe';
    const vma = r.vma ? ` ${r.vma} km/h` : '';
    const dist = Math.round(haversineKm(me.lat, me.lng, r.lat, r.lng) * 1000);
    const msg = `⚠️ Radar ${type}${vma} à ${dist}m`;

    if (settings.alertSound === 'voice' || settings.alertSound === 'both'){
      pushAlert(msg, 'warn', 8000);
      speak(`Radar ${type} à ${dist} mètres`);
    } else if (settings.alertSound === 'beep'){
      pushAlert(msg, 'warn', 8000);
      playBeep();
    }
    // 'silent' = juste l'alerte visuelle
  }

  // Reset quand on s'éloigne
  alertedRadars = new Set(
    [...alertedRadars].filter(id => {
      const r = radars.find(x => x.id === id);
      return r && haversineKm(me.lat, me.lng, r.lat, r.lng) < settings.alertDist * 2;
    })
  );
}

// Bip sonore
function playBeep(){
  const now = Date.now();
  if (now - lastBeepTime < 2000) return; // anti-spam
  lastBeepTime = now;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = 880; osc.type = 'sine';
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
    osc.start(); osc.stop(ctx.currentTime + 0.3);
  } catch(e){}
}

// Toggle on/off
export function toggleRadars(){
  settings.enabled = !settings.enabled;
  saveSettings({ enabled: settings.enabled });
  return settings.enabled;
}
export function isRadarsEnabled(){ return settings.enabled; }

// Initialise la couche GeoJSON sur la carte
export function initRadarLayer(){
  if (!mainMap) return;
  mainMap.addSource('radars', { type: 'geojson', data: { type:'FeatureCollection', features:[] } });
  mainMap.addLayer({
    id: 'radar-circles',
    type: 'circle',
    source: 'radars',
    paint: {
      'circle-radius': 8,
      'circle-color': ['case', ['==', ['get', 'isMobile'], 1], '#ff5252', '#ff9800'],
      'circle-opacity': 0.85,
      'circle-stroke-width': 2,
      'circle-stroke-color': '#fff'
    }
  });
  mainMap.addLayer({
    id: 'radar-labels',
    type: 'symbol',
    source: 'radars',
    layout: {
      'text-field': ['case', ['==', ['get', 'isMobile'], 1], '🚨', '📷'],
      'text-size': 14,
      'text-offset': [0, -1.2]
    }
  });

  // Popup au clic
  mainMap.on('click', 'radar-circles', (e) => {
    const p = e.features[0].properties;
    const type = p.isMobile ? '🚨 Mobile' : '📷 Fixe';
    const vma = p.vma ? ` · ${p.vma} km/h` : '';
    new maplibregl.Popup()
      .setLngLat(e.lngLat)
      .setHTML(`<b>${type}</b><br>ID: ${p.id}${vma}<br><small>Mis en service: ${p.date}</small>`)
      .addTo(mainMap);
  });
  mainMap.on('mouseenter', 'radar-circles', () => { mainMap.getCanvas().style.cursor = 'pointer'; });
  mainMap.on('mouseleave', 'radar-circles', () => { mainMap.getCanvas().style.cursor = ''; });

  updateRadarLayer();
}
