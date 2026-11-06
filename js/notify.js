// ============================================================
// NOTIFY : alertes visuelles, synthèse vocale avancée, pill statut
// Moteur de voix française : sélection intelligente + choix utilisateur
// ============================================================
import { $ } from './utils.js';
import { S, me } from './state.js';

let canVibrate = false;
document.addEventListener('pointerdown', () => { canVibrate = true; }, { once: true });

// ----- Cache des voix françaises -----
let frVoices = [];
let preferredVoiceName = localStorage.getItem('fc_voice') || '';
let voicesLoaded = false;

function loadVoices(){
  const all = speechSynthesis.getVoices();
  frVoices = all.filter(v => /^fr/i.test(v.lang));
  if (frVoices.length > 0) voicesLoaded = true;
}

// Écoute le chargement asynchrone des voix (Chrome les charge en différé)
if ('speechSynthesis' in window){
  loadVoices();
  speechSynthesis.onvoiceschanged = loadVoices;
  // Recharge de sécurité après 1s (certaines plateformes)
  setTimeout(loadVoices, 1000);
}

// ----- Sélection intelligente de la meilleure voix française -----
// Ordre de priorité : voix native Google > Microsoft > Apple > autres
// Préférence : voix locales (fr-FR > fr-CA > fr-BE > fr-CH)
function pickBestVoice(){
  if (!frVoices.length) return null;

  // 1. Voix préférée sauvegardée par l'utilisateur
  if (preferredVoiceName){
    const v = frVoices.find(v => v.name === preferredVoiceName);
    if (v) return v;
  }

  // 2. Classement par qualité (mots-clés dans le nom)
  const keywords = ['Google', 'Microsoft', 'Natural', 'Premium', 'Enhanced', 'Neural'];
  const scored = frVoices.map(v => {
    let score = 0;
    const n = v.name.toLowerCase();
    if (v.lang === 'fr-FR') score += 10;
    if (/google/i.test(n)) score += 20;
    if (/microsoft/i.test(n)) score += 15;
    if (/natural|neural|premium|enhanced/i.test(n)) score += 12;
    if (/audrey|thomas|amelie|aurelie|marie/i.test(n)) score += 8;
    if (v.localService) score += 5;      // voix offline = plus rapide
    return { v, score };
  }).sort((a,b) => b.score - a.score);

  return scored[0].v;
}

// ----- Export pour l'UI (overlay de choix) -----
export function listFrenchVoices(){
  if (!voicesLoaded) loadVoices();
  return frVoices.slice();
}
export function setPreferredVoice(name){
  preferredVoiceName = name || '';
  if (name) localStorage.setItem('fc_voice', name);
  else localStorage.removeItem('fc_voice');
}
export function getPreferredVoiceName(){
  return preferredVoiceName;
}
export function testVoice(){
  speak('Bonjour, ceci est un test de la voix sélectionnée.');
}

// ----- Synthèse vocale principale -----
export function speak(txt){
  if (!S.voiceOn || !('speechSynthesis' in window)) return;

  // Arrête toute parole en cours (évite l'empilement)
  speechSynthesis.cancel();

  // Nettoyage : supprime les emojis qui font bégayer le TTS
  const clean = txt.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu,'').trim();
  if (!clean) return;

  const u = new SpeechSynthesisUtterance(clean);
  u.lang = 'fr-FR';
  u.rate = 1.02;
  u.pitch = 1.0;

  const best = pickBestVoice();
  if (best){
    u.voice = best;
    u.lang = best.lang;          // respect du dialecte choisi
  }

  speechSynthesis.speak(u);
}

// ----- Alertes visuelles + vibration + voix -----
export function pushAlert(msg, type='warn', ttl=6000){
  const el = document.createElement('div');
  el.className = 'alert ' + type;
  el.textContent = msg;
  $('#alerts').prepend(el);
  if (canVibrate && navigator.vibrate) navigator.vibrate(type==='warn'?[200,100,200]:[100]);
  if (type==='warn') speak(msg);
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
