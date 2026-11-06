// ============================================================
// UTILS : calculs purs + helpers DOM + mini bus d'événements
// ============================================================
import { PALETTE } from './config.js';

export const $ = s => document.querySelector(s);

export function haversineKm(lat1,lng1,lat2,lng2){
  const R=6371, dLat=(lat2-lat1)*Math.PI/180, dLng=(lng2-lng1)*Math.PI/180;
  const a=Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}
export function bearingDeg(lat1,lng1,lat2,lng2){
  const r=x=>x*Math.PI/180, d=x=>x*180/Math.PI;
  const y=Math.sin(r(lng2-lng1))*Math.cos(r(lat2));
  const x=Math.cos(r(lat1))*Math.sin(r(lat2))-Math.sin(r(lat1))*Math.cos(r(lat2))*Math.cos(r(lng2-lng1));
  return (d(Math.atan2(y,x))+360)%360;
}
export const ago = ts => { const s=Math.round((Date.now()-ts)/1000); return s<60?`${s}s`:`${Math.round(s/60)}min`; };
export const freshDev = d => Date.now()-(d.updatedAt||0) < 60000;
export const serializePts = pts => pts.map(p=>p[0].toFixed(4)+','+p[1].toFixed(4)).join(';');
export const parsePts = s => (s||'').split(';').filter(Boolean).map(s=>s.split(',').map(Number));
export const initialOf = n => (n||'?').replace(/[^\wà-ÿ]/gi,'').charAt(0).toUpperCase() || '🚗';
export const colorFor = id => PALETTE[[...id].reduce((a,c)=>a+c.charCodeAt(0),0) % PALETTE.length];

// Mini bus : évite les imports circulaires entre modules
const listeners = {};
export const bus = {
  on(evt, fn){ (listeners[evt] = listeners[evt] || []).push(fn); },
  emit(evt, data){ (listeners[evt] || []).forEach(fn => fn(data)); }
};
