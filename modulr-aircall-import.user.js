// ==UserScript==
// @name         Modulr - Import Aircall
// @namespace    https://github.com/BiggerThanTheMall
// @version      1.0.0
// @description  Recherche un appel Aircall depuis la fiche client Modulr puis crée une note normalisée.
// @match        https://courtage.modulr.fr/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/BiggerThanTheMall/modulr-aircall-import/main/modulr-aircall-import.user.js
// @downloadURL  https://raw.githubusercontent.com/BiggerThanTheMall/modulr-aircall-import/main/modulr-aircall-import.user.js
// ==/UserScript==

(function () {
  'use strict';

  const VERSION = '1.0.0';
  const API_ROOT = 'https://aircallmodulr.netlify.app';
  const BTN_ID = 'modulr-aircall-import-btn';
  const MODAL_ID = 'modulr-aircall-modal';

  const esc = value => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  function getClientId() {
    const url = new URL(location.href);
    const direct = url.searchParams.get('id') || url.searchParams.get('client_id') || url.searchParams.get('entity_id');
    if (direct && /^\d+$/.test(direct)) return direct;
    const taskLink = [...document.querySelectorAll('a.task_manage[id*="entity_name:Client:entity_id:"]')]
      .find(el => el.offsetParent !== null)
      || document.querySelector('a.task_manage[id*="entity_name:Client:entity_id:"]');
    const match = String(taskLink?.id || '').match(/entity_id:(\d+)/i);
    return match ? match[1] : '';
  }

  function getClientName() {
    return document.querySelector('.vcard_name')?.textContent?.trim() || 'Client';
  }

  function normalizePhone(value) {
    return String(value || '').replace(/[^+\d]/g, '').trim();
  }

  function getPhonesOnPage() {
    const phones = new Set();
    const selectors = [
      'a[href^="tel:"]', 'input[type="tel"]', 'input[name*="phone" i]', 'input[name*="mobile" i]',
      '[data-phone]', '[class*="phone" i]', '[class*="mobile" i]', '[id*="phone" i]', '[id*="mobile" i]'
    ];
    for (const node of document.querySelectorAll(selectors.join(','))) {
      const candidates = [
        node.getAttribute?.('href')?.replace(/^tel:/i, ''),
        node.getAttribute?.('data-phone'), node.value, node.textContent
      ].filter(Boolean);
      for (const candidate of candidates) {
        const phone = normalizePhone(candidate);
        const digits = phone.replace(/\D/g, '');
        if (digits.length >= 8 && digits.length <= 15) phones.add(phone);
      }
    }
    return [...phones];
  }

  async function api(path) {
    const response = await fetch(`${API_ROOT}${path}`, {
      method: 'GET', mode: 'cors', credentials: 'omit', headers: { Accept: 'application/json' }
    });
    const text = await response.text();
    let body = {};
    try { body = JSON.parse(text || '{}'); } catch (_) {}
    if (!response.ok) throw new Error(body?.error || `API HTTP ${response.status}`);
    return body;
  }

  function formatDate(timestamp) {
    return timestamp ? new Date(Number(timestamp) * 1000).toLocaleDateString('fr-FR') : '';
  }
  function formatTime(timestamp) {
    return timestamp ? new Date(Number(timestamp) * 1000).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '';
  }
  function formatDuration(seconds) {
    const total = Math.max(0, Number(seconds) || 0);
    return `${Math.floor(total / 60)} min ${String(total % 60).padStart(2, '0')} s`;
  }

  function createModal(title, html) {
    document.getElementById(MODAL_ID)?.remove();
    const overlay = document.createElement('div');
    overlay.id = MODAL_ID;
    overlay.style.cssText = 'position:fixed;inset:0;z-index:999999;background:rgba(15,23,42,.42);display:flex;align-items:center;justify-content:center;padding:20px';
    overlay.innerHTML = `<div style="width:min(820px,96vw);max-height:88vh;overflow:auto;background:#fff;border-radius:8px;box-shadow:0 18px 55px rgba(0,0,0,.28);font-family:Arial,sans-serif"><div style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid #e5e7eb"><strong style="font-size:16px;color:#334155">${esc(title)}</strong><button type="button" data-close style="border:0;background:transparent;font-size:23px;cursor:pointer;color:#64748b">×</button></div><div style="padding:16px">${html}</div></div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('[data-close]').onclick = () => overlay.remove();
    overlay.onclick = event => { if (event.target === overlay) overlay.remove(); };
    return overlay;
  }

  function chooseCall(calls) {
    return new Promise(resolve => {
      const rows = calls.map((call, index) => `<button type="button" data-call="${index}" style="width:100%;text-align:left;padding:12px;margin-bottom:8px;background:#fff;border:1px solid #dbe2ea;border-radius:6px;cursor:pointer"><div style="font-weight:700;color:#334155">${esc(formatDate(call.started_at))} à ${esc(formatTime(call.started_at))} — ${call.direction === 'inbound' ? 'Entrant' : 'Sortant'}</div><div style="margin-top:4px;color:#64748b">${esc(call.raw_digits || 'Numéro inconnu')} · ${esc(call.user?.name || 'Collaborateur inconnu')} · ${esc(formatDuration(call.duration))}</div></button>`).join('');
      const modal = createModal(`Appels Aircall — ${getClientName()}`, rows);
      modal.querySelectorAll('[data-call]').forEach(button => {
        button.onclick = () => {
          const selected = calls[Number(button.dataset.call)];
          modal.remove(); resolve(selected);
        };
      });
    });
  }

  function extractEvaluationScore(evaluation) {
    const evaluations = evaluation?.evaluations;
    if (!Array.isArray(evaluations) || !evaluations.length) return '';
    const scores = evaluations.map(item => item?.score?.normalized_score ?? item?.normalized_score ?? item?.score).filter(value => typeof value === 'number');
    if (!scores.length) return '';
    return `${Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)}/100`;
  }

  function extractInsights(detail) {
    const i = detail.insights || {};
    const summary = i.summary?.summary?.content || i.summary?.summary || i.summary?.content || '';
    const sentimentValue = i.sentiments?.sentiment?.participants?.find(p => p.type === 'external')?.value || i.sentiments?.sentiment?.participants?.[0]?.value || i.sentiments?.sentiment || '';
    const sentimentMap = { POSITIVE: 'Positif', NEGATIVE: 'Négatif', NEUTRAL: 'Neutre' };
    const sentiment = sentimentMap[String(sentimentValue).toUpperCase()] || sentimentValue || '';
    const topicPayload = i.topics?.topic?.content || i.topics?.topics || [];
    const topics = Array.isArray(topicPayload) ? topicPayload.map(item => typeof item === 'string' ? item : item?.name || item?.label || item?.content).filter(Boolean) : [];
    const actionPayload = i.action_items?.action_items || i.action_items?.items || [];
    const actions = Array.isArray(actionPayload) ? actionPayload.map(item => typeof item === 'string' ? item : item?.content || item?.text || item?.title).filter(Boolean) : [];
    return { summary: String(summary || '').trim(), sentiment: String(sentiment || '').trim(), topics: [...new Set(topics)], actions: [...new Set(actions)], quality: extractEvaluationScore(detail.evaluation) };
  }

  function buildNote(detail) {
    const call = detail.call;
    const ai = extractInsights(detail);
    const collaborator = call.user?.name || 'Collaborateur inconnu';
    const title = `Contact téléphonique (${formatDate(call.started_at)}) - ${collaborator}`;
    const content = [
      `DATE / HEURE : ${formatDate(call.started_at)} à ${formatTime(call.started_at)}`,
      `SENS : ${call.direction === 'inbound' ? 'Appel entrant' : 'Appel sortant'}`,
      `NUMÉRO : ${call.raw_digits || 'Non disponible'}`,
      `DURÉE : ${formatDuration(call.duration)}`, '',
      'RÉSUMÉ DE L’ÉCHANGE :', ai.summary || 'Analyse Aircall en cours ou non disponible.', '',
      'QUALITÉ DE L’APPEL :', ai.quality || 'Non disponible.', '',
      'SENTIMENT :', ai.sentiment || 'Non disponible.', '',
      'SUJETS ABORDÉS :', ai.topics.length ? ai.topics.map(item => `- ${item}`).join('\n') : 'Non disponible.', '',
      'ACTIONS À ENTREPRENDRE :', ai.actions.length ? ai.actions.map(item => `- ${item}`).join('\n') : 'Aucune action identifiée.'
    ].join('\n');
    return { title, content };
  }

  async function createModulrNote(clientId, title, notes) {
    const body = new URLSearchParams();
    const values = {
      mcut: '', action: 'send', mode: 'create', entity_id: String(clientId), class_name: 'Client', 'task[task_id]': '', create_tour: '0',
      task_mode: 'simple_event', add_following_task: '', selectItemadd_following_task: '', 'task[name]': title, 'task[recall_date]': '', 'task[recall_hour]': '',
      task_actors_list_id: '0', selectItemtask_actors_list_id: '0', selectGrouptask_actors_list_id: '', 'task[event_type]': '195', 'selectItemtask[event_type]': '195',
      model_message: '0', selectItemmodel_message: '0', message_template_type: 'event', task_related_to_entity: '0', selectItemtask_related_to_entity: '0',
      'task[call_id]': '', 'task[call_qualification]': '', 'selectItemtask[call_qualification]': '', 'task[notes]': notes
    };
    for (const [key, value] of Object.entries(values)) body.append(key, value);
    const response = await fetch('/fr/scripts/Tasks/TasksManage.php', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json, text/javascript, */*; q=0.01' }, body: body.toString()
    });
    if (!response.ok) throw new Error(`Modulr HTTP ${response.status}`);
    return response.text();
  }

  async function previewAndImport(call) {
    const detail = await api(`/api/calls/${encodeURIComponent(call.id)}`);
    const note = buildNote(detail);
    const modal = createModal('Prévisualisation de la note Aircall', `<div style="margin-bottom:12px;color:#64748b">Client Modulr #${esc(getClientId())} · appel Aircall #${esc(call.id)}</div><label style="display:block;font-weight:700;margin-bottom:5px">Titre</label><input id="aircall-note-title" style="width:100%;box-sizing:border-box;padding:9px;border:1px solid #cbd5e1;border-radius:5px;margin-bottom:12px" value="${esc(note.title)}"><label style="display:block;font-weight:700;margin-bottom:5px">Contenu</label><textarea id="aircall-note-content" style="width:100%;height:330px;box-sizing:border-box;padding:10px;border:1px solid #cbd5e1;border-radius:5px;font-family:Arial,sans-serif">${esc(note.content)}</textarea><div style="display:flex;justify-content:flex-end;margin-top:12px"><button type="button" id="aircall-import-confirm" style="padding:8px 14px;border:0;border-radius:5px;background:#2563eb;color:#fff;font-weight:700;cursor:pointer">Importer dans Modulr</button></div>`);
    modal.querySelector('#aircall-import-confirm').onclick = async event => {
      const button = event.currentTarget; button.disabled = true; button.textContent = 'Import...';
      try {
        await createModulrNote(getClientId(), modal.querySelector('#aircall-note-title').value.trim(), modal.querySelector('#aircall-note-content').value);
        modal.remove(); alert('Note Aircall créée dans Modulr.'); location.reload();
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
    const initial = button.textContent; button.disabled = true; button.textContent = '…';
    try {
      const result = await api(`/api/calls?phones=${encodeURIComponent(phones.join(','))}&hours=48`);
      const calls = Array.isArray(result.calls) ? result.calls : [];
      if (!calls.length) return alert('Aucun appel Aircall trouvé sur les 48 dernières heures pour les numéros de cette fiche.');
      const selected = calls.length === 1 ? calls[0] : await chooseCall(calls);
      if (selected) await previewAndImport(selected);
    } catch (error) {
      alert(`Aircall : ${error.message}`);
    } finally {
      button.disabled = false; button.textContent = initial;
    }
  }

  function isVisible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
  }

  function normalizeText(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function findEventsTitle() {
    const nodes = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,div,span,strong,label')].filter(isVisible);
    return nodes.find(el => {
      const ownText = [...el.childNodes].filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.textContent).join(' ');
      const text = normalizeText(ownText || el.textContent);
      return text === 'evenements' || text.startsWith('evenements ');
    }) || null;
  }

  function isPlusControl(el) {
    if (!isVisible(el)) return false;
    const text = normalizeText(el.textContent);
    const meta = normalizeText(`${el.id || ''} ${el.className || ''} ${el.title || ''} ${el.getAttribute?.('aria-label') || ''}`);
    const icon = el.querySelector?.('[class*="plus"], [class*="add"], .fa-plus, .glyphicon-plus');
    return text === '+' || Boolean(icon) || /(^| )(plus|add|ajout|create|new)( |$)/.test(meta);
  }

  function findEventsPlus() {
    const title = findEventsTitle();
    const controls = [...document.querySelectorAll('button,a,[role="button"]')].filter(isPlusControl);
    if (!controls.length) return null;

    if (title) {
      const tr = title.getBoundingClientRect();
      const scored = controls.map(el => {
        const r = el.getBoundingClientRect();
        const vertical = Math.abs((r.top + r.height / 2) - (tr.top + tr.height / 2));
        const horizontal = Math.abs(r.left - tr.right);
        const rightBias = r.left >= tr.left ? 0 : 500;
        return { el, score: vertical * 8 + horizontal + rightBias };
      }).sort((a, b) => a.score - b.score);
      if (scored[0]?.score < 1400) return scored[0].el;
    }

    return controls
      .filter(el => el.getBoundingClientRect().left > window.innerWidth * 0.45)
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0] || null;
  }

  function injectButton() {
    if (document.getElementById(BTN_ID) || !getClientId()) return;
    const plus = findEventsPlus();
    if (!plus?.parentElement) return;

    const button = document.createElement('button');
    button.id = BTN_ID;
    button.type = 'button';
    button.title = `Récupérer un appel Aircall · v${VERSION}`;
    button.setAttribute('aria-label', 'Récupérer un appel Aircall');
    button.innerHTML = '&#9742;';
    button.style.cssText = 'width:30px;height:30px;margin:0 5px 0 0;padding:0;border:0;border-radius:3px;background:#5f86a1;color:#fff;font-size:17px;font-weight:700;line-height:30px;text-align:center;cursor:pointer;vertical-align:middle;display:inline-block';
    button.onclick = event => { event.preventDefault(); event.stopPropagation(); run(button); };
    plus.parentElement.insertBefore(button, plus);
  }

  const observer = new MutationObserver(() => injectButton());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  injectButton();
  setTimeout(injectButton, 500);
  setTimeout(injectButton, 1500);
  setTimeout(injectButton, 3000);
})();
