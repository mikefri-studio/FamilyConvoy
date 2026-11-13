// ============================================================
// NOTIFY v9 : VOIX SYSTÈME PREMIUM par défaut (Google Neural2 /
// Microsoft Natural) — illimitées et gratuites.
// ElevenLabs conservé uniquement sur choix manuel explicite.
// Migration auto : ancien choix ElevenLabs -> système premium.
// ============================================================
import { $ } from './utils.js';
import { S, me } from './state.js';
import { ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID } from './config.js';

let canVibrate = false;
document.addEventListener('pointerdown', () => { canVibrate = true; }, { once: true });

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
let elevenlabsQuota = parseInt(localStorage.getItem('fc_elevenlabs_quota') || '10000');

// 🔄 Migration une fois : ancien choix ElevenLabs -> voix système premium
if (localStorage.getItem('fc_voice_migrated') !== '1'){
  if (voiceChoice.startsWith('eleven:')){
    localStorage.removeItem('fc_voice');
    voiceChoice = '';
    console.log('[TTS] Migration : voix système premium par défaut');
  }
  localStorage.setItem('fc_voice_migrated', '1');
}

const ELEVENLABS_VOICES = [
  { id:'eleven:Adam', name:'Adam ⭐', sub:'ElevenLabs · profonde · autoritaire', icon:'🎙️', voiceId:'pNInz6obbf5AWCGqNKO0' },
  { id:'eleven:Antoni', name:'Antoni ⭐', sub:'ElevenLabs · chaleureuse', icon:'🎙️', voiceId:'ErXwobaYiN019PkySvjV' },
  { id:'eleven:Daniel', name:'Daniel ⭐', sub:'ElevenLabs · mature · sérieuse', icon:'🎙️', voiceId:'onwK4e9ZLuTAKqWW03F9' },
  { id:'eleven:Rachel', name:'Rachel ⭐', sub:'ElevenLabs · naturelle', icon:'🎙️', voiceId:'21m00Tcm4TlvDq8ikWAM' },
  { id:'eleven:Bella', name:'Bella ⭐', sub:'ElevenLabs · douce', icon:'🎙️', voiceId:'EXAVITQu4vr4xnSDxMaL' },
  { id:'eleven:Charlotte', name:'Charlotte ⭐', sub:'ElevenLabs · énergique', icon:'🎙️', voiceId:'XB0fDUnXU5powFXDhCwa' }
];

export function listVoiceOptions(){
  if (!voicesLoaded) loadVoices();
  const isKeyValid = ELEVENLABS_API_KEY && ELEVENLABS_API_KEY !== 'sk_...';
  const eleven = isKeyValid && elevenlabsQuota > 0 ? ELEVENLABS_VOICES : [];
  const best = pickBestVoice();
  return [
    ...eleven,
    ...frVoices.map(v => {
      const isPremium = /premium|enhanced|natural|neural|google|microsoft/i.test(v.name);
      const isBest = best && v.name === best.name;
      return {
        id:'sys:'+v.name,
        name: isPremium ? `${v.name} ⭐` : v.name,
        sub:`${v.lang} · ${v.localService?'📱 offline':'️ en ligne'}${isPremium?' · PREMIUM':''}${isBest?' · ✅ RECOMMANDÉE':''}`,
        icon:'🎤'
      };
    })
  ];
}
export function getVoiceChoice(){ return voiceChoice; }
export function setVoiceChoice(id){
  voiceChoice = id || '';
  if (id) localStorage.setItem('fc_voice', id); else localStorage.removeItem('fc_voice');
}
export function getActiveEngine(){
  const isKeyValid = ELEVENLABS_API_KEY && ELEVENLABS_API_KEY !== 'sk_...';
  if (voiceChoice.startsWith('eleven:') && isKeyValid && elevenlabsQuota > 0) return 'ElevenLabs (quota payant)';
  return 'Système premium (illimité)';
}

// ---------- Audio + file + anti-répétition ----------
let currentAudio = null;
let queue = [];
let speaking = false;
let lastText = '';
let lastAt = 0;

function stopAll(){
  queue = [];
  if (currentAudio){ try{ currentAudio.pause(); }catch(e){} currentAudio = null; }
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}
function playBlob(blob){
  return new Promise((res, rej) => {
    const a = new Audio(URL.createObjectURL(blob));
    currentAudio = a;
    a.onended = () => { currentAudio = null; res(); };
    a.onerror = () => { currentAudio = null; rej(new Error('audio')); };
    a.play().catch(rej);
  });
}
function elevenlabsSpeak(clean, voiceId){
  return new Promise(async (resolve, reject) => {
    const isKeyValid = ELEVENLABS_API_KEY && ELEVENLABS_API_KEY !== 'sk_...';
    if (!isKeyValid || elevenlabsQuota <= 0) return reject(new Error('quota/clé'));
    try {
      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: 'POST',
        headers: { 'xi-api-key': ELEVENLABS_API_KEY, 'Content-Type':'application/json', 'Accept':'audio/mpeg' },
        body: JSON.stringify({ text: clean, model_id:'eleven_multilingual_v2',
          voice_settings:{ stability:0.5, similarity_boost:0.75 } })
      });
      if (!res.ok) throw new Error('http ' + res.status);
      const blob = await res.blob();
      elevenlabsQuota -= clean.length;
      localStorage.setItem('fc_elevenlabs_quota', elevenlabsQuota);
      await playBlob(blob);
      resolve();
    } catch(e){ reject(e); }
  });
}

// ---------- 🥇 Classement : Google Neural2 / Microsoft Natural en tête ----------
function pickBestVoice(){
  if (!frVoices.length) return null;
  if (voiceChoice.startsWith('sys:')){
    const v = frVoices.find(v => v.name === voiceChoice.slice(4));
    if (v) return v;
  }
  const scored = frVoices.map(v => {
    let score = 0; const n = v.name.toLowerCase();
    if (v.lang === 'fr-FR') score += 10;
    if (/neural2|neural/i.test(n)) score += 40;   // 🥇 Google Neural2
    if (/natural/i.test(n)) score += 40;          // 🥇 Microsoft Natural
    if (/premium|enhanced/i.test(n)) score += 35;
    if (/google/i.test(n)) score += 25;
    if (/microsoft/i.test(n)) score += 20;
    if (/audrey|thomas|amelie|aurelie|marie|henri|julie|hortense|paul|denise|eloise/i.test(n)) score += 8;
    if (v.localService) score += 5;
    return { v, score };
  }).sort((a,b) => b.score - a.score);
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
function runSpeak(clean){
  speaking = true;
  const next = () => { speaking = false; const q = queue.shift(); if (q) start(q); };
  const engines = [];
  const isKeyValid = ELEVENLABS_API_KEY && ELEVENLABS_API_KEY !== 'sk_...';
  if (voiceChoice.startsWith('eleven:') && isKeyValid && elevenlabsQuota > 0){
    const v = ELEVENLABS_VOICES.find(x => x.id === voiceChoice);
    if (v) engines.push(() => elevenlabsSpeak(clean, v.voiceId));
  }
  engines.push(() => systemSpeak(clean));
  (async () => {
    for (const fn of engines){
      try { await fn(); next(); return; } catch(e){}
    }
    next();
  })();
}
function start(clean){
  lastText = clean; lastAt = Date.now();
  runSpeak(clean);
}
export function speak(txt, opts = {}){
  if (!S.voiceOn || !('speechSynthesis' in window)) return;
  const clean = txt.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu,'').trim();
  if (!clean) return;
  const now = Date.now();
  if (!opts.force && clean === lastText && now - lastAt < 20000) return;
  if (opts.interrupt){ queue = []; stopAll(); speaking = false; start(clean); return; }
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
