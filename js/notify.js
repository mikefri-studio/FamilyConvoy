// ============================================================
// NOTIFY v12 : voix MICROSOFT EDGE FR via ton worker Cloudflare
// (liste française chargée dynamiquement depuis /voices)
// + repli automatique sur voix système si worker indisponible
// ============================================================
import { $ } from './utils.js';
import { S, me } from './state.js';

const EDGE_TTS_URL = 'https://cloudflare-edge-tts.mikefri-app.workers.dev';
const VOICES_CACHE_KEY = 'fc_edge_voices';
const AUDIO_CACHE_PREFIX = 'fc_tts_';
const VOICES_TTL = 24 * 3600000;   // liste voix : 24 h
const AUDIO_TTL = 7 * 86400000;    // audio : 7 jours

const LOCALE_META = {
  'fr-FR': { flag:'🇫🇷', label:'France', rank:0 },
  'fr-CA': { flag:'🇨🇦', label:'Canada', rank:1 },
  'fr-BE': { flag:'🇧🇪', label:'Belgique', rank:2 },
  'fr-CH': { flag:'🇨🇭', label:'Suisse', rank:3 }
};

let canVibrate = false;
document.addEventListener('pointerdown', () => { canVibrate = true; }, { once: true });

// ---------- Voix système (repli) ----------
let frVoices = [];
let voicesLoaded = false;
function loadVoices(){
  const all = speechSynthesis.getVoices();
  frVoices = all.filter(v => /^fr/i.test(v.lang));
  if (frVoices.length) voicesLoaded = true;
}
if ('speechSynthesis' in window){
  loadVoices();
  speechSynthesis.onvoiceschanged = loadVoices;
  setTimeout(loadVoices, 1000);
}

let voiceChoice = localStorage.getItem('fc_voice') || '';
if (voiceChoice.startsWith('eleven:')){
  localStorage.removeItem('fc_voice');
  voiceChoice = '';
}

// ---------- Chargement dynamique des voix FR du worker ----------
function getEdgeVoicesCache(){
  try {
    const raw = localStorage.getItem(VOICES_CACHE_KEY);
    if (!raw) return [];
    const { ts, voices } = JSON.parse(raw);
    if (Date.now() - ts > VOICES_TTL) return [];
    return voices || [];
  } catch(e){ return []; }
}
export async function refreshEdgeVoices(){
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(`${EDGE_TTS_URL}/voices`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) throw new Error('http ' + res.status);
    const j = await res.json();
    const fr = (j.voices || [])
      .filter(v => v.ShortName && v.ShortName.startsWith('fr-'))
      .map(v => {
        const locale = v.ShortName.slice(0, 5);
        const meta = LOCALE_META[locale] || { flag:'🌐', label: locale, rank:9 };
        const base = v.ShortName.replace(/^fr-[A-Z]{2}-/, '').replace(/Neural$/, '');
        return {
          id: 'edge:' + v.ShortName,
          short: v.ShortName,
          name: `${meta.flag} ${base} ⭐`,
          sub: `Microsoft Edge · ${v.Gender === 'Female' ? 'féminine' : 'masculine'} · ${meta.label}${/Multilingual/i.test(v.ShortName) ? ' · multilingue' : ''}`,
          icon: '🎙️',
          rank: meta.rank
        };
      })
      .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
    // Denise (France) toujours en tête
    const di = fr.findIndex(v => v.short === 'fr-FR-DeniseNeural');
    if (di > 0) fr.unshift(fr.splice(di, 1)[0]);
    localStorage.setItem(VOICES_CACHE_KEY, JSON.stringify({ ts: Date.now(), voices: fr }));
    console.log('[TTS] Voix Edge FR chargées :', fr.length);
    return fr;
  } catch(e){
    console.warn('[TTS] Worker injoignable, voix système uniquement :', e.message);
    return [];
  }
}
refreshEdgeVoices(); // au démarrage

export function listVoiceOptions(){
  if (!voicesLoaded) loadVoices();
  const edge = getEdgeVoicesCache();
  const best = pickBestVoice();
  const sys = frVoices.map(v => {
    const isPremium = /premium|enhanced|natural|neural|google|microsoft/i.test(v.name);
    const isBest = best && v.name === best.name;
    return {
      id: 'sys:' + v.name,
      name: isPremium ? `${v.name} ⭐` : v.name,
      sub: `${v.lang} · ${v.localService ? '📱 offline' : '️ en ligne'}${isPremium ? ' · PREMIUM' : ''}${isBest && !edge.length ? ' · ✅ RECOMMANDÉE' : ''}`,
      icon: '🎤'
    };
  });
  const tagged = edge.map((v, i) => ({ ...v, sub: v.sub + (i === 0 ? ' · ✅ RECOMMANDÉE' : '') }));
  return [...tagged, ...sys];
}
export function getVoiceChoice(){ return voiceChoice; }
export function setVoiceChoice(id){
  voiceChoice = id || '';
  if (id) localStorage.setItem('fc_voice', id); else localStorage.removeItem('fc_voice');
}

// ---------- Cache audio ----------
function getCachedAudio(text, voice){
  try {
    const raw = localStorage.getItem(AUDIO_CACHE_PREFIX + btoa(unescape(encodeURIComponent(text + '|' + voice))));
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    if (Date.now() - ts > AUDIO_TTL) return null;
    return data;
  } catch(e){ return null; }
}
function setCachedAudio(text, voice, base64){
  if (base64.length > 300000) return; // trop gros, pas de cache
  try {
    localStorage.setItem(AUDIO_CACHE_PREFIX + btoa(unescape(encodeURIComponent(text + '|' + voice))),
      JSON.stringify({ data: base64, ts: Date.now() }));
  } catch(e){ /* quota plein : on ignore */ }
}

// ---------- Synthèse via worker ----------
let workerDown = false;
async function edgeSpeak(clean, shortName){
  const cached = getCachedAudio(clean, shortName);
  if (cached) return playData(cached);
  const res = await fetch(`${EDGE_TTS_URL}/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: clean, voice: shortName })
  });
  if (!res.ok) throw new Error('http ' + res.status);
  const blob = await res.blob();
  if (!blob.size) throw new Error('audio vide');
  const base64 = await new Promise(r => {
    const reader = new FileReader();
    reader.onload = () => r(reader.result.split(',')[1]);
    reader.readAsDataURL(blob);
  });
  setCachedAudio(clean, shortName, base64);
  return playData(base64);
}
function playData(base64){
  return new Promise((res, rej) => {
    const a = new Audio('data:audio/mpeg;base64,' + base64);
    a.onended = res;
    a.onerror = () => rej(new Error('lecture'));
    a.play().catch(rej);
  });
}

// ---------- Voix système ----------
function pickBestVoice(){
  if (!frVoices.length) return null;
  if (voiceChoice.startsWith('sys:')){
    const v = frVoices.find(v => v.name === voiceChoice.slice(4));
    if (v) return v;
  }
  const scored = frVoices.map(v => {
    let score = 0; const n = v.name.toLowerCase();
    if (v.lang === 'fr-FR') score += 10;
    if (/neural2|neural/i.test(n)) score += 40;
    if (/natural/i.test(n)) score += 40;
    if (/premium|enhanced/i.test(n)) score += 35;
    if (/google/i.test(n)) score += 25;
    if (/microsoft/i.test(n)) score += 20;
    if (/audrey|thomas|amelie|aurelie|marie|henri|julie|hortense|paul|denise|eloise/i.test(n)) score += 8;
    if (v.localService) score += 5;
    return { v, score };
  }).sort((a, b) => b.score - a.score);
  return scored[0].v;
}
function systemSpeak(clean){
  return new Promise(res => {
    let done = false;
    const fin = () => { if (!done){ done = true; res(); } };
    const u = new SpeechSynthesisUtterance(clean);
    u.lang = 'fr-FR'; u.rate = 1.02;
    const best = pickBestVoice();
    if (best){ u.voice = best; u.lang = best.lang; }
    u.onend = fin; u.onerror = fin;
    setTimeout(fin, Math.min(15000, clean.length * 90 + 3000));
    speechSynthesis.speak(u);
  });
}

// ---------- File d'attente + anti-répétition ----------
let speaking = false;
let queue = [];
let lastText = '';
let lastAt = 0;

function runSpeak(clean){
  speaking = true;
  const next = () => { speaking = false; const q = queue.shift(); if (q) start(q); };
  (async () => {
    if (voiceChoice.startsWith('edge:') && !workerDown){
      try {
        await edgeSpeak(clean, voiceChoice.slice(5));
        next(); return;
      } catch(e){
        console.warn('[TTS] Edge échec → système :', e.message);
        workerDown = true;
      }
    }
    await systemSpeak(clean);
    next();
  })();
}
function start(clean){
  lastText = clean; lastAt = Date.now();
  runSpeak(clean);
}
export function speak(txt, opts = {}){
  if (!S.voiceOn || !('speechSynthesis' in window)) return;
  const clean = txt.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '').trim();
  if (!clean) return;
  const now = Date.now();
  if (!opts.force && clean === lastText && now - lastAt < 20000) return;
  if (opts.interrupt){
    queue = [];
    speechSynthesis.cancel();
    speaking = false;
    start(clean);
    return;
  }
  if (speaking || queue.length){
    if (queue[queue.length - 1] === clean) return;
    queue.push(clean);
    if (queue.length > 2) queue.shift();
    return;
  }
  start(clean);
}
export function testVoice(){ speak('Bonjour, ceci est un test de la voix sélectionnée.', { interrupt:true, force:true }); }

// ---------- Alertes ----------
export function pushAlert(msg, type='warn', ttl=6000, opts={}){
  const el = document.createElement('div');
  el.className = 'alert ' + type;
  el.textContent = msg;
  $('#alerts').prepend(el);
  if (canVibrate && navigator.vibrate) navigator.vibrate(type==='warn'?[200,100,200]:[100]);
  if (type==='warn' && !opts.silent) speak(msg);
  setTimeout(()=>el.remove(), ttl);
}
export function updateStatus(){
  if (!S.joined) { $('#status').textContent = 'hors convoi'; return; }
  const roleTxt = me.role === 'screen' ? '📺 écran · ' : '';
  $('#status').textContent = `${S.netIcon} ${roleTxt}${S.hidden?'position masquée · ':''}±${Math.round(me.accuracy||0)}m · ${me.speed} km/h`;
}
export function updateRoleUI(){
  $('#role-pill').classList.toggle('hidden', !(S.joined && me.role === 'screen'));
}
