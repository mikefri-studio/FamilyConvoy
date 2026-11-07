// ============================================================
// NOTIFY v5.1 : avec logs de debug pour diagnostic
// ============================================================
import { $ } from './utils.js';
import { S, me } from './state.js';
import { EDGE_TTS_URL } from './config.js';

let canVibrate = false;
document.addEventListener('pointerdown', () => { canVibrate = true; }, { once: true });

let frVoices = [];
let voicesLoaded = false;
function loadVoices(){
  const all = speechSynthesis.getVoices();
  frVoices = all.filter(v => /^fr/i.test(v.lang));
  if (frVoices.length) voicesLoaded = true;
  console.log('[TTS] voix système FR chargées :', frVoices.map(v=>v.name));
}
if ('speechSynthesis' in window){
  loadVoices();
  speechSynthesis.onvoiceschanged = loadVoices;
  setTimeout(loadVoices, 1000);
}

let voiceChoice = localStorage.getItem('fc_voice') || '';

const EDGE_VOICES = [
  { id:'edge:fr-FR-DeniseNeural', name:'Denise 🧠', sub:'Neuronale Edge · directe navigateur · RECOMMANDÉE', icon:'🧠' },
  { id:'edge:fr-FR-HenriNeural',  name:'Henri 🧠',  sub:'Neuronale Edge · directe navigateur', icon:'🧠' },
  { id:'edge:fr-FR-VivienneMultilingualNeural', name:'Vivienne 🧠', sub:'Neuronale Edge · multilingue', icon:'🧠' },
  { id:'edge:fr-FR-RemyMultilingualNeural',     name:'Rémy 🧠',     sub:'Neuronale Edge · multilingue', icon:'🧠' }
];
const POLLY_VOICES = [
  { id:'cloud:Celine',  name:'Céline ☁️',  sub:'Amazon Polly · cloud gratuit', icon:'☁️' },
  { id:'cloud:Mathieu', name:'Mathieu ☁️', sub:'Amazon Polly · cloud gratuit', icon:'☁️' }
];
const POLLY_URL = 'https://api.streamelements.com/kappa/v2/speech?voice={v}&text={t}';

let edgeBroken = false, workerBroken = false, pollyBroken = false;

export function listVoiceOptions(){
  if (!voicesLoaded) loadVoices();
  return [
    ...EDGE_VOICES,
    ...POLLY_VOICES,
    ...frVoices.map(v => ({ id:'sys:'+v.name, name:v.name, sub:`${v.lang} · ${v.localService?'📱 offline':'☁️ en ligne'}`, icon:'🎤' }))
  ];
}
export function getVoiceChoice(){ return voiceChoice; }
export function setVoiceChoice(id){
  voiceChoice = id || '';
  if (id) localStorage.setItem('fc_voice', id); else localStorage.removeItem('fc_voice');
  console.log('[TTS] voix choisie :', voiceChoice);
}

const TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const GEC_VERSION = '1-131.0.2903.86';
async function secMsGec(){
  const secs = BigInt(Math.floor(Date.now() / 1000)) + 11644473600n;
  let ticks = secs * 10000000n;
  ticks = ticks - (ticks % 3000000000n);
  const data = new TextEncoder().encode(ticks.toString() + TOKEN);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2,'0')).join('').toUpperCase();
}
const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');

let currentAudio = null;
function stopAll(){
  if (currentAudio){ try{ currentAudio.pause(); }catch(e){} currentAudio = null; }
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}
function playBlob(blob){
  return new Promise((res, rej) => {
    const a = new Audio(URL.createObjectURL(blob));
    currentAudio = a;
    a.onended = () => { currentAudio = null; res(); };
    a.onerror = (e) => { currentAudio = null; console.error('[TTS] audio error', e); rej(new Error('audio')); };
    a.play().catch(rej);
  });
}
function remoteSpeak(url, label){
  console.log('[TTS]', label, '→', url);
  return fetch(url)
    .then(r => { 
      console.log('[TTS]', label, 'réponse HTTP', r.status);
      if (!r.ok) throw new Error('http ' + r.status); 
      return r.blob(); 
    })
    .then(b => { console.log('[TTS]', label, 'blob reçu', b.size, 'octets'); return playBlob(b); });
}

function edgeDirectSpeak(clean, voice){
  return new Promise((resolve, reject) => {
    (async () => {
      let ws = null, settled = false;
      const timer = setTimeout(() => {
        if (!settled){ settled = true; try{ ws && ws.close(); }catch(e){} console.log('[TTS] edge timeout'); reject(new Error('timeout')); }
      }, 15000);
      try {
        const gec = await secMsGec();
        const url = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${TOKEN}&Sec-MS-GEC=${gec}&Sec-MS-GEC-Version=${GEC_VERSION}`;
        console.log('[TTS] edge WS connecting...');
        ws = new WebSocket(url);
        const chunks = [];
        const reqId = crypto.randomUUID();
        const ts = () => new Date().toISOString();
        ws.onopen = () => {
          console.log('[TTS] edge WS ouvert');
          ws.send(
            `X-Timestamp:${ts()}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n` +
            `{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n`
          );
          ws.send(
            `X-RequestId:${reqId}\r\nContent-Type:application/ssml; charset=utf-8\r\nPath:ssml\r\n\r\n` +
            `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='fr-FR'>` +
            `<voice name='${voice}'><prosody pitch='+0Hz' rate='+0%' volume='+0%'>${esc(clean)}</prosody></voice></speak>`
          );
        };
        ws.onmessage = ev => {
          if (typeof ev.data === 'string'){
            if (ev.data.includes('Path:turn.end')){
              if (settled) return;
              settled = true; clearTimeout(timer);
              try{ ws.close(); }catch(e){}
              console.log('[TTS] edge terminé, chunks :', chunks.length);
              playBlob(new Blob(chunks, { type:'audio/mpeg' })).then(resolve).catch(reject);
            }
            return;
          }
          const buf = new Uint8Array(ev.data);
          if (buf.length < 2) return;
          const hl = (buf[0] << 8) | buf[1];
          const audio = buf.slice(2 + hl);
          if (audio.length) chunks.push(audio);
        };
        ws.onerror = (e) => {
          console.log('[TTS] edge WS error', e);
          if (!settled){ settled = true; clearTimeout(timer); reject(new Error('ws error')); }
        };
      } catch(e){
        console.log('[TTS] edge exception', e);
        if (!settled){ settled = true; clearTimeout(timer); reject(e); }
      }
    })();
  });
}

function pickBestVoice(){
  if (!frVoices.length) return null;
  if (voiceChoice.startsWith('sys:')){
    const v = frVoices.find(v => v.name === voiceChoice.slice(4));
    if (v) return v;
  }
  const scored = frVoices.map(v => {
    let score = 0; const n = v.name.toLowerCase();
    if (v.lang === 'fr-FR') score += 10;
    if (/google/i.test(n)) score += 20;
    if (/microsoft/i.test(n)) score += 15;
    if (/natural|neural|premium|enhanced/i.test(n)) score += 12;
    if (/audrey|thomas|amelie|aurelie|marie/i.test(n)) score += 8;
    if (v.localService) score += 5;
    return { v, score };
  }).sort((a,b) => b.score - a.score);
  return scored[0].v;
}
function systemSpeak(clean){
  console.log('[TTS] fallback système');
  const u = new SpeechSynthesisUtterance(clean);
  u.lang = 'fr-FR'; u.rate = 1.02;
  const best = pickBestVoice();
  if (best){ u.voice = best; u.lang = best.lang; }
  speechSynthesis.speak(u);
}

const pollyUrl = (voice, clean) => POLLY_URL.replace('{v}', voice).replace('{t}', encodeURIComponent(clean));
const workerUrl = (voice, clean) => `${EDGE_TTS_URL}?voice=${encodeURIComponent(voice)}&text=${encodeURIComponent(clean)}`;

export function speak(txt){
  if (!S.voiceOn || !('speechSynthesis' in window)) { console.log('[TTS] désactivé'); return; }
  const clean = txt.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu,'').trim();
  if (!clean) return;
  stopAll();
  console.log('[TTS] speak :', clean, '| choix :', voiceChoice);

  const engines = [];
  if (voiceChoice.startsWith('edge:')){
    const voice = voiceChoice.slice(5);
    if (!edgeBroken && navigator.onLine)   engines.push(['edge',   () => edgeDirectSpeak(clean, voice)]);
    if (!workerBroken && EDGE_TTS_URL && navigator.onLine) engines.push(['worker', () => remoteSpeak(workerUrl(voice, clean), 'worker')]);
    if (!pollyBroken && navigator.onLine)  engines.push(['polly',  () => remoteSpeak(pollyUrl('Celine', clean), 'polly')]);
  } else if (voiceChoice.startsWith('cloud:')){
    if (!pollyBroken && navigator.onLine)  engines.push(['polly',  () => remoteSpeak(pollyUrl(voiceChoice.slice(6), clean), 'polly')]);
  }
  engines.push(['sys', () => { systemSpeak(clean); return Promise.resolve(); }]);

  (async () => {
    for (const [name, fn] of engines){
      try { 
        console.log('[TTS] tentative :', name);
        await fn(); 
        console.log('[TTS] succès :', name);
        return; 
      }
      catch(e){
        console.log('[TTS] échec :', name, '→', e.message);
        if (name === 'edge') edgeBroken = true;
        if (name === 'worker') workerBroken = true;
        if (name === 'polly') pollyBroken = true;
      }
    }
  })();
}
export function testVoice(){
  speak('Bonjour, ceci est un test de la voix sélectionnée.');
}

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
