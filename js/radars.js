// ============================================================
// RADARS v3 : fusion CSV GitHub + Firestore RadarZen
// + signalements communautaires en temps réel
// ============================================================
import { haversineKm } from './utils.js';
import { S, me } from './state.js';
import { pushAlert, speak } from './notify.js';
import { getRadarzenRadars, getRadarzenReports, initRadarZen } from './radarzen.js';

const RADAR_CSV_URL = 'https://raw.githubusercontent.com/mikefri-studio/RadarApp/master/app/src/main/assets/radars.csv';
const RADAR_CACHE_KEY = 'fc_radars_cache';
const RADAR_CACHE_TTL = 7 * 86400000;
const RADAR_SETTINGS_KEY = 'fc_radar_settings';
const REPORT_EXPIRY = 2 * 3600000; // 2h

const DEFAULT_SETTINGS = {
  displayRadius: 25,
  alertDist: 0.5,
  showFixed: true,
  showMobile: true,
  showReports: true,
  alertSound: 'voice',
  minSpeed: 30,
  showVMA: true,
  enabled: true,
  useRadarZen: true
};

let radars = [];
let radarGeoJSON = null;
let settings = { ...DEFAULT_SETTINGS };
let alertedRadars = new Set();
let mainMap = null;
let lastBeepTime = 0;

// ---------- Réglages ----------
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
}

// ---------- Parse CSV ----------
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
      id: 'csv_' + cols[0].trim(),
      type: cols[1].trim(),
      date: cols[2].trim(),
      vma: parseInt(cols[3]) || null,
      lat, lng,
      isMobile: /mobile|portable|remorqu|feux/i.test(cols[1]),
      isReport: false,
      source: 'csv'
    };
  }).filter(Boolean);
}

// ---------- Chargement ----------
export async function loadRadars(){
  loadSettings();
  
  // Charge RadarZen en parallèle
  if (settings.useRadarZen) await initRadarZen();

  // Charge CSV GitHub (cache 7 jours)
  const cached = localStorage.getItem(RADAR_CACHE_KEY);
  if (cached){
    const { ts, data } = JSON.parse(cached);
    if (Date.now() - ts < RADAR_CACHE_TTL){
      radars = data;
    } else {
      await downloadCSV();
    }
  } else {
    await downloadCSV();
  }

  // Fusion avec RadarZen
  if (settings.useRadarZen){
    const rzRadars = getRadarzenRadars();
    const rzReports = getRadarzenReports();
    
    const existingCoords = new Set(radars.map(r => `${r.lat.toFixed(4)},${r.lng.toFixed(4)}`));
    for (const r of rzRadars){
      const key = `${r.lat.toFixed(4)},${r.lng.toFixed(4)}`;
      if (!existingCoords.has(key)){
        radars.push(r);
        existingCoords.add(key);
      }
    }
    for (const r of rzReports){
      radars.push(r);
    }
  }

  buildGeoJSON();
  console.log('[Radars] total :', radars.length);
}

async function downloadCSV(){
  try {
    const res = await fetch(RADAR_CSV_URL);
    if (!res.ok) throw new Error('http ' + res.status);
    const text = await res.text();
    radars = parseCSV(text);
    localStorage.setItem(RADAR_CACHE_KEY, JSON.stringify({ ts: Date.now(), data: radars }));
    console.log('[Radars] CSV téléchargés :', radars.length);
  } catch(e){
    console.error('[Radars] erreur CSV :', e.message);
    if (localStorage.getItem(RADAR_CACHE_KEY)){
      radars = JSON.parse(localStorage.getItem(RADAR_CACHE_KEY)).data;
    }
  }
}

// ---------- GeoJSON ----------
function buildGeoJSON(){
  radarGeoJSON = {
    type: 'FeatureCollection',
    features: radars.map(r => ({
      type: 'Feature',
      properties: {
        id: r.id,
        type: r.type || '',
        vma: r.vma || null,
        date: r.date || '',
        isMobile: r.isMobile ? 1 : 0,
        isReport: r.isReport ? 1 : 0,
        description: r.description || '',
        timestamp: r.timestamp || 0,
        numero: r.numero || ''
      },
      geometry: { type: 'Point', coordinates: [r.lng, r.lat] }
    }))
  };
}

export function setMainMap(map){ mainMap = map; }

function getFilteredRadars(){
  if (!radars.length) return [];
  return radars.filter(r => {
    if (r.isReport){
      if (!settings.showReports) return false;
      if (Date.now() - r.timestamp > REPORT_EXPIRY) return false;
    } else {
      if (r.isMobile && !settings.showMobile) return false;
      if (!r.isMobile && !settings.showFixed) return false;
    }
    if (settings.displayRadius > 0 && me.lat != null){
      if (haversineKm(me.lat, me.lng, r.lat, r.lng) > settings.displayRadius) return false;
    }
    return true;
  });
}

export function updateRadarLayer(){
  if (!mainMap || !radarGeoJSON) return;
  const source = mainMap.getSource('radars');
  if (!source) return;

  const filtered = getFilteredRadars();
  const filteredIds = new Set(filtered.map(r => r.id));
  const fc = {
    type: 'FeatureCollection',
    features: radarGeoJSON.features.filter(f => filteredIds.has(f.properties.id))
  };
  source.setData(fc);
}

// ---------- Alertes ----------
export function checkRadarAlert(){
  if (!settings.enabled || me.lat == null || !S.joined) return;
  if (me.speed < settings.minSpeed) return;

  const close = radars.filter(r => {
    if (r.isReport && !settings.showReports) return false;
    if (!r.isReport && r.isMobile && !settings.showMobile) return false;
    if (!r.isReport && !r.isMobile && !settings.showFixed) return false;
    if (r.isReport && Date.now() - r.timestamp > REPORT_EXPIRY) return false;
    return haversineKm(me.lat, me.lng, r.lat, r.lng) <= settings.alertDist;
  });

  for (const r of close){
    if (alertedRadars.has(r.id)) continue;
    alertedRadars.add(r.id);
    
    let msg = '';
    if (r.isReport){
      const typeLabel = {
        accident: '🚗 Accident', travaux: '🚧 Travaux',
        radar_mobile: '🚨 Radar mobile', danger: '⚠️ Danger',
        bouchon: '🐌 Bouchon', autre: '❓ Autre'
      }[r.type] || '📍 Signalement';
      msg = `${typeLabel} à ${Math.round(haversineKm(me.lat, me.lng, r.lat, r.lng) * 1000)}m`;
      speak(`Signalement ${r.type} à proximité`);
    } else {
      const type = r.isMobile ? 'mobile' : 'fixe';
      const vma = r.vma ? ` ${r.vma} km/h` : '';
      const dist = Math.round(haversineKm(me.lat, me.lng, r.lat, r.lng) * 1000);
      msg = `⚠️ Radar ${type}${vma} à ${dist}m`;
      speak(`Radar ${type} à ${dist} mètres`);
    }

    if (settings.alertSound === 'voice' || settings.alertSound === 'both'){
      pushAlert(msg, 'warn', 8000);
    } else if (settings.alertSound === 'beep'){
      pushAlert(msg, 'warn', 8000);
      playBeep();
    } else {
      pushAlert(msg, 'warn', 8000);
    }
  }

  alertedRadars = new Set(
    [...alertedRadars].filter(id => {
      const r = radars.find(x => x.id === id);
      return r && haversineKm(me.lat, me.lng, r.lat, r.lng) < settings.alertDist * 2;
    })
  );
}

function playBeep(){
  const now = Date.now();
  if (now - lastBeepTime < 2000) return;
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

export function toggleRadars(){
  settings.enabled = !settings.enabled;
  saveSettings({ enabled: settings.enabled });
  if (settings.enabled) updateRadarLayer();
  else if (mainMap && mainMap.getSource('radars')) {
      mainMap.getSource('radars').setData({ type: 'FeatureCollection', features: [] });
  }
  return settings.enabled;
}
export function isRadarsEnabled(){ return settings.enabled; }

// ---------- Couche GeoJSON ----------
export function initRadarLayer(){
  if (!mainMap) return;

  // 🛡️ CORRECTION CRUCIALE : Nettoyage avant recréation
  // Quand on change de fond de carte (style.load), cette fonction est rappelée.
  // Sans ce nettoyage, MapLibre planterait avec "Layer already exists".
  if (mainMap.getLayer('radar-labels')) mainMap.removeLayer('radar-labels');
  if (mainMap.getLayer('radar-circles')) mainMap.removeLayer('radar-circles');
  if (mainMap.getSource('radars')) mainMap.removeSource('radars');

  // 🛡️ Nettoyage des événements pour éviter les doublons (qui spammeraient les popups)
  mainMap.off('click', 'radar-circles');
  mainMap.off('mouseenter', 'radar-circles');
  mainMap.off('mouseleave', 'radar-circles');

  mainMap.addSource('radars', { type: 'geojson', data: { type:'FeatureCollection', features:[] } });
  mainMap.addLayer({
    id: 'radar-circles',
    type: 'circle',
    source: 'radars',
    paint: {
      'circle-radius': 9,
      'circle-color': [
        'case',
        ['==', ['get', 'isReport'], 1], '#2196f3',
        ['==', ['get', 'isMobile'], 1], '#ff5252',
        '#ff9800'
      ],
      'circle-opacity': 0.9,
      'circle-stroke-width': 2,
      'circle-stroke-color': '#fff'
    }
  });
  mainMap.addLayer({
    id: 'radar-labels',
    type: 'symbol',
    source: 'radars',
    layout: {
      'text-field': [
        'case',
        ['==', ['get', 'isReport'], 1], '📍',
        ['==', ['get', 'isMobile'], 1], '🚨',
        '📷'
      ],
      'text-size': 14,
      'text-offset': [0, -1.3]
    }
  });

  const handleRadarClick = (e) => {
    if (!e.features || !e.features.length) return;
    const p = e.features[0].properties;
    let html = '';
    if (p.isReport){
      const typeLabel = {
        accident: '🚗 Accident', travaux: '🚧 Travaux',
        radar_mobile: '🚨 Radar mobile', danger: '⚠️ Danger',
        bouchon: '🐌 Bouchon', autre: '❓ Autre'
      }[p.type] || '📍 Signalement';
      html = `<b>${typeLabel}</b><br><small>${p.description || 'Aucune description'}<br>il y a ${Math.round((Date.now()-p.timestamp)/60000)} min</small>`;
    } else {
      const type = p.isMobile ? '🚨 Mobile' : '📷 Fixe';
      const vma = p.vma ? ` · ${p.vma} km/h` : '';
      html = `<b>${type}</b><br>ID: ${p.numero || p.id}${vma}<br><small>Mis en service: ${p.date}</small>`;
    }
    new maplibregl.Popup().setLngLat(e.lngLat).setHTML(html).addTo(mainMap);
  };

  const handleMouseEnter = () => { mainMap.getCanvas().style.cursor = 'pointer'; };
  const handleMouseLeave = () => { mainMap.getCanvas().style.cursor = ''; };

  mainMap.on('click', 'radar-circles', handleRadarClick);
  mainMap.on('mouseenter', 'radar-circles', handleMouseEnter);
  mainMap.on('mouseleave', 'radar-circles', handleMouseLeave);

  updateRadarLayer();
}
