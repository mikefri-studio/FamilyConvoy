// ============================================================
// DIAG : panneau diagnostic in-app (GPS, réseau, nav, voix, radars)
// ============================================================
import { $ } from './utils.js';
import { S, me } from './state.js';
import { getVoiceChoice } from './notify.js';
import { isRadarsEnabled, getSettings } from './radars.js';

function row(k, v){ return `<div class="diag-row"><span>${k}</span><b>${v}</b></div>`; }

function render(){
  const c = navigator.connection || {};
  const N = window.FC_NAV || {};
  const rs = getSettings();
  $('#diag-body').innerHTML = [
    row('📍 GPS', me.lat != null ? `${me.lat.toFixed(4)}, ${me.lng.toFixed(4)} · ±${Math.round(me.accuracy||0)} m · ${me.speed} km/h` : 'aucun fix'),
    row('📶 Réseau', `${navigator.onLine ? 'en ligne' : 'HORS LIGNE'}${c.effectiveType ? ' · ' + c.effectiveType : ''}${c.downlink ? ' · ' + c.downlink + ' Mb/s' : ''}`),
    row('🔋 Batterie', S.phoneBattery != null ? S.phoneBattery + ' %' : '?'),
    row('👥 Convoi', S.joined ? `${me.group} · ${me.name} · rôle ${me.role}` : 'non rejoint'),
    row('🧭 Navigation', (N.active && N.active()) ? `active · ${N.engine ? (N.engine() || 'calcul…') : '?'} · mode ${N.mode ? N.mode() : '?'} · ${N.points ? N.points() : 0} pts · tracés ${N.drawn ? N.drawn() : 0}` : 'inactive'),
    row('🎤 Voix', `${getVoiceChoice() || 'auto (système)'}`),
    row('📷 Radars', `${isRadarsEnabled() ? 'activés' : 'désactivés'} · rayon ${rs.displayRadius} km · alerte ${rs.alertDist} km`),
    row('📲 Service Worker', navigator.serviceWorker && navigator.serviceWorker.controller ? 'actif' : 'absent'),
    row('🕒 Heure', new Date().toLocaleString('fr-FR'))
  ].join('');
}

export function openDiag(){
  render();
  $('#diag-overlay').classList.remove('hidden');
}
export function bindDiagUI(){
  $('#btn-diag').onclick = () => { $('#menu-overlay').classList.add('hidden'); openDiag(); };
  $('#btn-diag-refresh').onclick = render;
  $('#btn-close-diag').onclick = () => $('#diag-overlay').classList.add('hidden');
}
