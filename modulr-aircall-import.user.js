// ==UserScript==
// @name         Modulr - Import Aircall
// @namespace    https://github.com/BiggerThanTheMall
// @version      0.2.0
// @description  Recherche un appel Aircall depuis la fiche client Modulr puis cree une note normalisee.
// @match        https://courtage.modulr.fr/*
// @grant        GM_xmlhttpRequest
// @connect      modulr-aircall-import.netlify.app
// @updateURL    https://raw.githubusercontent.com/BiggerThanTheMall/modulr-aircall-import/main/modulr-aircall-import.user.js
// @downloadURL  https://raw.githubusercontent.com/BiggerThanTheMall/modulr-aircall-import/main/modulr-aircall-import.user.js
// ==/UserScript==

(function () {
  'use strict';

  const BTN_ID = 'modulr-aircall-import-btn';
  const BACKEND = 'https://modulr-aircall-import.netlify.app';

  function getClientId() {
    const url = new URL(window.location.href);
    const fromUrl = url.searchParams.get('id') || url.searchParams.get('client_id') || url.searchParams.get('entity_id');
    if (fromUrl && /^\d+$/.test(fromUrl)) return fromUrl;
    const taskLink = [...document.querySelectorAll('a.task_manage[id*="entity_name:Client:entity_id:"]')]
      .find(el => el.offsetParent !== null) || document.querySelector('a.task_manage[id*="entity_name:Client:entity_id:"]');
    const match = String(taskLink?.id || '').match(/entity_id:(\d+)/i);
    return match ? match[1] : '';
  }

  function getClientName() {
    return document.querySelector('.vcard_name')?.innerText?.trim() || 'Client';
  }

  function normalizePhone(value) {
    return String(value || '').replace(/[^+\d]/g, '').trim();
  }

  function getPhonesOnPage() {
    const set = new Set();
    const nodes = document.querySelectorAll([
      'a[href^="tel:"]','input[type="tel"]','input[name*="phone" i]','input[name*="mobile" i]',
      '[class*="phone" i]','[class*="mobile" i]','[id*="phone" i]','[id*="mobile" i]'
    ].join(','));
    for (const node of nodes) {
      const values = [node.getAttribute?.('href')?.replace(/^tel:/i, ''), node.value, node.textContent].filter(Boolean);
      for (const raw of values) {
        const phone = normalizePhone(raw);
        const digits = phone.replace(/\D/g, '');
        if (digits.length >= 8 && digits.length <= 15) set.add(phone);
      }
    }
    return [...set];
  }

  function gmRequest(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET', url, headers: { Accept: 'application/json' }, timeout: 30000,
        onload: response => {
          try {
            const data = JSON.parse(response.responseText || '{}');
            if (response.status >= 200 && response.status < 300) resolve(data);
            else reject(new Error(data.error || `HTTP ${response.status}`));
          } catch (error) { reject(error); }
        },
        onerror: () => reject(new Error('Connexion au service Aircall impossible')),
        ontimeout: () => reject(new Error('Délai de réponse Aircall dépassé'))
      });
    });
  }

  function formatDate(ts) { return ts ? new Date(Number(ts) * 1000).toLocaleDateString('fr-FR') : ''; }
  function formatTime(ts) { return ts ? new Date(Number(ts) * 1000).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : ''; }
  function formatDuration(seconds) {
    const total = Number(seconds || 0), minutes = Math.floor(total / 60), secs = total % 60;
    return `${minutes} min ${String(secs).padStart(2, '0')} s`;
  }

  function createModal(title, bodyHtml) {
    document.getElementById('modulr-aircall-modal')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'modulr-aircall-modal';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:999999;background:rgba(15,23,42,.38);display:flex;align-items:center;justify-content:center;padding:20px';
    overlay.innerHTML = `<div style="width:min(780px,96vw);max-height:88vh;overflow:auto;background:white;border-radius:8px;box-shadow:0 18px 55px rgba(0,0,0,.25);font-family:Arial,sans-serif"><div style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid #e5e7eb"><strong style="font-size:16px;color:#334155">${title}</strong><button type="button" id="modulr-aircall-close" style="border:0;background:transparent;font-size:22px;cursor:pointer;color:#64748b">×</button></div><div style="padding:16px">${bodyHtml}</div></div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#modulr-aircall-close').onclick = () => overlay.remove();
    overlay.onclick = event => { if (event.target === overlay) overlay.remove(); };
    return overlay;
  }

  function chooseCall(calls) {
    return new Promise(resolve => {
      const rows = calls.map((call, index) => `<button type="button" data-call-index="${index}" style="width:100%;text-align:left;padding:12px;margin-bottom:8px;background:#fff;border:1px solid #dbe2ea;border-radius:6px;cursor:pointer"><div style="font-weight:700;color:#334155">${formatDate(call.started_at)} à ${formatTime(call.started_at)} — ${call.direction === 'inbound' ? 'Entrant' : 'Sortant'}</div><div style="margin-top:4px;color:#64748b">${call.raw_digits || 'Numéro inconnu'} · ${call.user?.name || 'Collaborateur inconnu'} · ${formatDuration(call.duration)}</div></button>`).join('');
      const modal = createModal(`Appels Aircall — ${getClientName()}`, rows);
      modal.querySelectorAll('[data-call-index]').forEach(button => {
        button.onclick = () => { const selected = calls[Number(button.dataset.callIndex)]; modal.remove(); resolve(selected); };
      });
    });
  }

  function extractEvaluationScore(evaluation) {
    const values = evaluation?.evaluations;
    if (!Array.isArray(values) || !values.length) return '';
    const scores = values.map(item => item?.score?.normalized_score).filter(value => typeof value === 'number');
    if (!scores.length) return '';
    return `${(scores.reduce((sum, value) => sum + value, 0) / scores.length).toFixed(0)}/100`;
  }

  function extractAi(detail) {
    const insights = detail.insights || {};
    const summary = insights.summary?.summary?.content || '';
    const rawSentiment = insights.sentiments?.sentiment?.participants?.find(p => p.type === 'external')?.value
      || insights.sentiments?.sentiment?.participants?.[0]?.value || '';
    const moodMap = { POSITIVE: 'Positif', NEGATIVE: 'Négatif', NEUTRAL: 'Neutre' };
    const sentiment = moodMap[String(rawSentiment).toUpperCase()] || rawSentiment || '';
    const topics = Array.isArray(insights.topics?.topic?.content) ? insights.topics.topic.content : [];
    const actions = Array.isArray(insights.action_items?.action_items)
      ? insights.action_items.action_items.map(item => typeof item === 'string' ? item : item?.content).filter(Boolean)
      : [];
    return { summary, sentiment, topics, actions, quality: extractEvaluationScore(detail.evaluation) };
  }

  function buildNote(detail) {
    const call = detail.call;
    const ai = extractAi(detail);
    const collaborator = call.user?.name || 'Collaborateur inconnu';
    const title = `Contact téléphonique (${formatDate(call.started_at)}) - ${collaborator}`;
    const notes = [
      `DATE / HEURE : ${formatDate(call.started_at)} à ${formatTime(call.started_at)}`,
      `SENS : ${call.direction === 'inbound' ? 'Appel entrant' : 'Appel sortant'}`,
      `NUMÉRO : ${call.raw_digits || 'Non disponible'}`,
      `DURÉE : ${formatDuration(call.duration)}`,
      '', 'RÉSUMÉ DE L’ÉCHANGE :', ai.summary || 'Analyse Aircall en cours ou non disponible.',
      '', 'QUALITÉ DE L’APPEL :', ai.quality || 'Non disponible.',
      '', 'SENTIMENT :', ai.sentiment || 'Non disponible.',
      '', 'SUJETS ABORDÉS :', ai.topics.length ? ai.topics.map(item => `- ${item}`).join('\n') : 'Non disponible.',
      '', 'ACTIONS À ENTREPRENDRE :', ai.actions.length ? ai.actions.map(item => `- ${item}`).join('\n') : 'Aucune action identifiée.'
    ].join('\n');
    return { title, notes };
  }

  async function createModulrNote(clientId, title, notes) {
    const body = new URLSearchParams();
    body.append('mcut', ''); body.append('action', 'send'); body.append('mode', 'create');
    body.append('entity_id', String(clientId)); body.append('class_name', 'Client'); body.append('task[task_id]', '');
    body.append('create_tour', '0'); body.append('task_mode', 'simple_event'); body.append('add_following_task', '');
    body.append('selectItemadd_following_task', ''); body.append('task[name]', title); body.append('task[recall_date]', '');
    body.append('task[recall_hour]', ''); body.append('task_actors_list_id', '0'); body.append('selectItemtask_actors_list_id', '0');
    body.append('selectGrouptask_actors_list_id', ''); body.append('selectGrouptask_actors_list_id', '');
    body.append('task[event_type]', '195'); body.append('selectItemtask[event_type]', '195'); body.append('model_message', '0');
    body.append('selectItemmodel_message', '0'); body.append('message_template_type', 'event'); body.append('task_related_to_entity', '0');
    body.append('selectItemtask_related_to_entity', '0'); body.append('task[call_id]', ''); body.append('task[call_qualification]', '');
    body.append('selectItemtask[call_qualification]', ''); body.append('task[notes]', notes);

    const response = await fetch('https://courtage.modulr.fr/fr/scripts/Tasks/TasksManage.php', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json, text/javascript, */*; q=0.01' },
      body: body.toString()
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`Modulr HTTP ${response.status}`);
    return text;
  }

  async function importSelectedCall(call) {
    const detail = await gmRequest(`${BACKEND}/api/calls/${encodeURIComponent(call.id)}`);
    const prepared = buildNote(detail);
    const html = `<div style="margin-bottom:10px;color:#64748b">Client Modulr #${getClientId()} — appel Aircall #${call.id}</div><label style="font-weight:700">Titre</label><input id="modulr-aircall-title" style="width:100%;box-sizing:border-box;margin:5px 0 12px;padding:9px;border:1px solid #cbd5e1;border-radius:6px" value="${prepared.title.replace(/&/g,'&amp;').replace(/"/g,'&quot;')}"><label style="font-weight:700">Contenu</label><textarea id="modulr-aircall-note-preview" style="width:100%;height:340px;box-sizing:border-box;margin-top:5px;padding:10px;border:1px solid #cbd5e1;border-radius:6px;font-family:Arial,sans-serif">${prepared.notes.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</textarea><div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px"><button type="button" id="modulr-aircall-import-confirm" style="padding:8px 14px;border:0;border-radius:5px;background:#2563eb;color:white;font-weight:700;cursor:pointer">Importer dans Modulr</button></div>`;
    const modal = createModal('Prévisualisation de la note Aircall', html);
    modal.querySelector('#modulr-aircall-import-confirm').onclick = async event => {
      const button = event.currentTarget; button.disabled = true; button.textContent = 'Import...';
      try {
        await createModulrNote(getClientId(), modal.querySelector('#modulr-aircall-title').value, modal.querySelector('#modulr-aircall-note-preview').value);
        modal.remove(); alert('Note Aircall créée dans Modulr.'); window.location.reload();
      } catch (error) {
        alert(`Erreur création note Modulr : ${error.message}`); button.disabled = false; button.textContent = 'Importer dans Modulr';
      }
    };
  }

  async function run(button) {
    const clientId = getClientId();
    if (!clientId) return alert('Impossible d’identifier la fiche client Modulr.');
    const phones = getPhonesOnPage();
    if (!phones.length) return alert('Aucun numéro de téléphone exploitable trouvé sur cette fiche.');
    const initial = button.textContent; button.disabled = true; button.textContent = 'Recherche Aircall...';
    try {
      const result = await gmRequest(`${BACKEND}/api/calls?phones=${encodeURIComponent(phones.join(','))}&hours=48`);
      const calls = Array.isArray(result.calls) ? result.calls : [];
      if (!calls.length) return alert('Aucun appel Aircall trouvé sur les 48 dernières heures pour les numéros de cette fiche.');
      const selected = calls.length === 1 ? calls[0] : await chooseCall(calls);
      if (selected) await importSelectedCall(selected);
    } catch (error) { alert(`Aircall : ${error.message}`); }
    finally { button.disabled = false; button.textContent = initial; }
  }

  function injectButton() {
    if (document.getElementById(BTN_ID) || !getClientId()) return;
    const anchor = document.querySelector('a.task_manage[id*="entity_name:Client:entity_id:"]') || document.querySelector('.vcard_name');
    if (!anchor?.parentElement) return;
    const button = document.createElement('button');
    button.id = BTN_ID; button.type = 'button'; button.textContent = 'Récupérer un appel Aircall';
    button.style.cssText = 'margin:8px 6px;padding:7px 11px;border:1px solid #b9c4cf;border-radius:4px;background:#f6f8fa;color:#334155;font-weight:600;cursor:pointer';
    button.onclick = () => run(button); anchor.parentElement.appendChild(button);
  }

  const observer = new MutationObserver(injectButton);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  injectButton();
})();
