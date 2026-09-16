// ==UserScript==
// @name         Modulr - Import Aircall
// @namespace    https://github.com/BiggerThanTheMall
// @version      1.2.0
// @description  Recherche un appel Aircall depuis la fiche client Modulr puis crée un événement d'appel normalisé.
// @match        https://courtage.modulr.fr/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/BiggerThanTheMall/modulr-aircall-import/main/modulr-aircall-import.user.js
// @downloadURL  https://raw.githubusercontent.com/BiggerThanTheMall/modulr-aircall-import/main/modulr-aircall-import.user.js
// ==/UserScript==

(function () {
  'use strict';

  const VERSION = '1.2.0';
  const API_ROOT = 'https://aircallmodulr.netlify.app';
  const BTN_ID = 'modulr-aircall-import-btn';
  const MODAL_ID = 'modulr-aircall-modal';
  const HOURS = 48;

  const COLLABORATORS = [
    { modulr: 'Ghais Kalah', aircall: 'Ghais Kalah' },
    { modulr: 'Jake CASIMIR', aircall: 'Jake CASIMIR' },
    { modulr: 'Eddy KALAH', aircall: 'Eddy Kalah' },
    { modulr: 'Nadia KALAH', aircall: 'Nadia Kalah' },
    { modulr: 'Sheana KRIEF', aircall: 'Sheana KRIEF' },
    { modulr: 'Doryan KALAH', aircall: 'Doryan Kalah' },
    { modulr: 'Youness OUACHBAB', aircall: 'Youness OUACHBAB' },
    { modulr: 'Louli VULLIOD-PIN', aircall: 'Louli VULLIOD' }
  ];

  const esc = value => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  const normalizeName = value => String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  function getClientId() {
    const url = new URL(location.href);
    const direct = url.searchParams.get('id') || url.searchParams.get('client_id') || url.searchParams.get('entity_id');
    if (direct && /^\d+$/.test(direct)) return direct;
    const taskLink = document.querySelector('a.task_manage[id*="entity_name:Client:entity_id:"]');
    const match = String(taskLink?.id || '').match(/entity_id:(\d+)/i);
    return match ? match[1] : '';
  }

  function getClientName() {
    return document.querySelector('.vcard_name')?.textContent?.trim() || 'Client';
  }

  function detectCurrentCollaborator() {
    const probes = [
      document.querySelector('.connectedUser span.tooltip')?.getAttribute('title'),
      document.querySelector('.connectedUser span.tooltip')?.textContent,
      document.querySelector('.connectedUser')?.textContent,
      document.querySelector('span.tooltip span.fa-user')?.parentElement?.getAttribute('oldtitle'),
      document.querySelector('span.tooltip span.fa-user')?.parentElement?.textContent
    ].filter(Boolean).map(normalizeName);

    for (const collaborator of COLLABORATORS) {
      const target = normalizeName(collaborator.modulr);
      if (probes.some(value => value.includes(target) || target.includes(value))) return collaborator;
    }
    return COLLABORATORS[0];
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
      const values = [node.getAttribute?.('href')?.replace(/^tel:/i, ''), node.getAttribute?.('data-phone'), node.value, node.textContent].filter(Boolean);
      for (const raw of values) {
        const phone = normalizePhone(raw);
        const digits = phone.replace(/\D/g, '');
        if (digits.length >= 8 && digits.length <= 15) phones.add(phone);
      }
    }
    return [...phones].slice(0, 10);
  }

  async function api(path) {
    const response = await fetch(`${API_ROOT}${path}`, {
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      headers: { Accept: 'application/json' }
    });
    const text = await response.text();
    let body = {};
    try { body = JSON.parse(text || '{}'); } catch (_) {}
    if (!response.ok) throw new Error(body?.error || `API HTTP ${response.status}`);
    return body;
  }

  function formatDate(ts) {
    return ts ? new Date(Number(ts) * 1000).toLocaleDateString('fr-FR') : '';
  }
  function formatTime(ts) {
    return ts ? new Date(Number(ts) * 1000).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '';
  }
  function formatDuration(seconds) {
    const total = Math.max(0, Number(seconds) || 0);
    const minutes = Math.floor(total / 60);
    const secs = total % 60;
    return `${minutes} min ${String(secs).padStart(2, '0')} s`;
  }

  function createModal(title, html, width = 820) {
    document.getElementById(MODAL_ID)?.remove();
    const overlay = document.createElement('div');
    overlay.id = MODAL_ID;
    overlay.style.cssText = 'position:fixed;inset:0;z-index:999999;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;padding:20px';
    overlay.innerHTML = `
      <div style="width:min(${width}px,96vw);max-height:90vh;overflow:auto;background:#fff;border-radius:10px;box-shadow:0 22px 70px rgba(0,0,0,.30);font-family:Arial,sans-serif;color:#334155">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:15px 18px;border-bottom:1px solid #e5e7eb;background:#f8fafc;position:sticky;top:0;z-index:2">
          <strong style="font-size:16px">${esc(title)}</strong>
          <button type="button" data-close style="border:0;background:transparent;font-size:24px;cursor:pointer;color:#64748b">×</button>
        </div>
        <div style="padding:18px">${html}</div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('[data-close]').onclick = () => overlay.remove();
    overlay.onclick = event => { if (event.target === overlay) overlay.remove(); };
    return overlay;
  }

  function phoneSourcePicker(pagePhones) {
    return new Promise(resolve => {
      const detected = [...new Set(pagePhones || [])];
      const phoneRows = detected.length
        ? detected.map(phone => `
          <label style="display:flex;align-items:center;gap:9px;padding:9px 10px;border:1px solid #e2e8f0;border-radius:7px;background:#fff;margin-bottom:7px;cursor:pointer">
            <input type="checkbox" data-page-phone value="${esc(phone)}" checked style="width:16px;height:16px">
            <span style="font-weight:600;color:#334155">${esc(phone)}</span>
          </label>`).join('')
        : '<div style="padding:10px 12px;border:1px dashed #cbd5e1;border-radius:7px;color:#94a3b8">Aucun numéro détecté sur cette fiche.</div>';

      const modal = createModal('Choisir le numéro de l’appel', `
        <div style="margin-bottom:14px;color:#64748b">L’événement sera enregistré sur <strong style="color:#334155">${esc(getClientName())}</strong>. Choisissez quel numéro Aircall rechercher.</div>
        <label style="display:block;border:1px solid #dbe2ea;border-radius:9px;padding:14px;margin-bottom:12px;background:#f8fafc;cursor:${detected.length ? 'pointer' : 'default'}">
          <div style="display:flex;align-items:center;gap:9px;margin-bottom:10px">
            <input type="radio" name="aircall-phone-source" value="page" ${detected.length ? 'checked' : 'disabled'}>
            <strong>Numéro(s) de la fiche client</strong>
          </div>
          <div style="padding-left:25px">${phoneRows}</div>
        </label>
        <label style="display:block;border:1px solid #dbe2ea;border-radius:9px;padding:14px;background:#fff;cursor:pointer">
          <div style="display:flex;align-items:center;gap:9px;margin-bottom:10px">
            <input type="radio" name="aircall-phone-source" value="manual" ${detected.length ? '' : 'checked'}>
            <strong>Saisir un autre numéro</strong>
          </div>
          <div style="padding-left:25px">
            <input id="aircall-manual-phone" type="tel" inputmode="tel" placeholder="Ex. 06 12 34 56 78 ou +33 6 12 34 56 78" style="width:100%;box-sizing:border-box;padding:10px 11px;border:1px solid #cbd5e1;border-radius:6px;font-size:14px">
            <div style="font-size:12px;color:#64748b;margin-top:6px">Banquier, avocat, compagnie, prestataire, pompe funèbre, etc.</div>
          </div>
        </label>
        <div id="aircall-phone-error" style="display:none;margin-top:10px;padding:9px 11px;border-radius:6px;background:#fef2f2;color:#b91c1c;font-size:12px"></div>
        <div style="display:flex;justify-content:flex-end;margin-top:18px">
          <button id="aircall-phone-next" type="button" style="padding:9px 16px;border:0;border-radius:6px;background:#4f7892;color:#fff;font-weight:700;cursor:pointer">Continuer</button>
        </div>`);

      const manualInput = modal.querySelector('#aircall-manual-phone');
      manualInput?.addEventListener('focus', () => {
        const radio = modal.querySelector('input[name="aircall-phone-source"][value="manual"]');
        if (radio) radio.checked = true;
      });
      modal.querySelectorAll('[data-page-phone]').forEach(input => {
        input.addEventListener('change', () => {
          const radio = modal.querySelector('input[name="aircall-phone-source"][value="page"]');
          if (radio && !radio.disabled) radio.checked = true;
        });
      });
      modal.querySelector('#aircall-phone-next').onclick = () => {
        const source = modal.querySelector('input[name="aircall-phone-source"]:checked')?.value;
        const error = modal.querySelector('#aircall-phone-error');
        let phones = [];
        if (source === 'page') {
          phones = [...modal.querySelectorAll('[data-page-phone]:checked')].map(input => normalizePhone(input.value)).filter(Boolean);
          if (!phones.length) {
            error.textContent = 'Sélectionnez au moins un numéro de la fiche.';
            error.style.display = 'block';
            return;
          }
        } else {
          const phone = normalizePhone(manualInput?.value || '');
          const digits = phone.replace(/\D/g, '');
          if (digits.length < 8 || digits.length > 15) {
            error.textContent = 'Saisissez un numéro de téléphone valide (8 à 15 chiffres).';
            error.style.display = 'block';
            manualInput?.focus();
            return;
          }
          phones = [phone];
        }
        modal.remove();
        resolve([...new Set(phones)].slice(0, 10));
      };
    });
  }

  function collaboratorPicker(phones) {
    return new Promise(resolve => {
      const current = detectCurrentCollaborator();
      const options = COLLABORATORS.map(c => `<option value="${esc(c.aircall)}" ${c.aircall === current.aircall ? 'selected' : ''}>${esc(c.modulr)}</option>`).join('');
      const modal = createModal('Récupérer un appel Aircall', `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:16px">
          <div style="padding:12px;border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc">
            <div style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#64748b;margin-bottom:4px">Client ModulR</div>
            <strong>${esc(getClientName())}</strong>
          </div>
          <div style="padding:12px;border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc">
            <div style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#64748b;margin-bottom:4px">Numéro(s) recherché(s)</div>
            <strong>${phones.map(esc).join(' · ')}</strong>
          </div>
        </div>
        <label style="display:block;font-weight:700;margin-bottom:6px">Collaborateur concerné</label>
        <select id="aircall-collaborator" style="width:100%;box-sizing:border-box;padding:10px 11px;border:1px solid #cbd5e1;border-radius:6px;background:white;font-size:14px">${options}</select>
        <div style="font-size:12px;color:#64748b;margin-top:7px">Le collaborateur connecté est présélectionné. Vous pouvez choisir quelqu’un d’autre avant la recherche.</div>
        <div style="display:flex;justify-content:flex-end;margin-top:18px">
          <button id="aircall-search" type="button" style="padding:9px 16px;border:0;border-radius:6px;background:#4f7892;color:#fff;font-weight:700;cursor:pointer">Rechercher les appels</button>
        </div>`);
      modal.querySelector('#aircall-search').onclick = () => {
        const value = modal.querySelector('#aircall-collaborator').value;
        modal.remove();
        resolve(COLLABORATORS.find(c => c.aircall === value) || current);
      };
    });
  }

  function chooseCall(calls, collaborator) {
    return new Promise(resolve => {
      const rows = calls.map((call, index) => `
        <button type="button" data-call="${index}" style="width:100%;text-align:left;padding:13px 14px;margin-bottom:9px;background:#fff;border:1px solid #dbe2ea;border-radius:8px;cursor:pointer;transition:.15s">
          <div style="display:flex;justify-content:space-between;gap:12px;align-items:center">
            <strong style="color:#334155">${esc(formatDate(call.started_at))} à ${esc(formatTime(call.started_at))}</strong>
            <span style="font-size:12px;padding:3px 8px;border-radius:999px;background:${call.direction === 'inbound' ? '#e0f2fe' : '#ecfdf5'};color:#334155">${call.direction === 'inbound' ? 'Appel entrant' : 'Appel sortant'}</span>
          </div>
          <div style="margin-top:7px;color:#64748b">${esc(call.raw_digits || 'Numéro inconnu')} · ${esc(formatDuration(call.duration))}</div>
        </button>`).join('');
      const modal = createModal(`Appels de ${collaborator.modulr}`, `<div style="margin-bottom:12px;color:#64748b">${calls.length} appel${calls.length > 1 ? 's' : ''} correspondant au(x) numéro(s) sélectionné(s) sur les ${HOURS} dernières heures.</div>${rows}`);
      modal.querySelectorAll('[data-call]').forEach(button => {
        button.onclick = () => {
          const selected = calls[Number(button.dataset.call)];
          modal.remove();
          resolve(selected);
        };
      });
    });
  }

  function extractEvaluationScore(evaluation) {
    const values = evaluation?.evaluations;
    if (!Array.isArray(values) || !values.length) return '';
    const scores = values.map(item => item?.score?.normalized_score ?? item?.normalized_score ?? item?.score).filter(v => typeof v === 'number');
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
    const body = [
      title,
      '',
      `Date / heure : ${formatDate(call.started_at)} à ${formatTime(call.started_at)}`,
      `Sens : ${call.direction === 'inbound' ? 'Appel entrant' : 'Appel sortant'}`,
      `Numéro : ${call.raw_digits || 'Non disponible'}`,
      `Durée : ${formatDuration(call.duration)}`,
      '',
      'Résumé de l’échange',
      ai.summary || 'Analyse Aircall en cours ou non disponible.',
      '',
      'Qualité de l’appel',
      ai.quality || 'Non disponible.',
      '',
      'Sentiment',
      ai.sentiment || 'Non disponible.',
      '',
      'Sujets abordés',
      ai.topics.length ? ai.topics.map(item => `• ${item}`).join('\n') : 'Non disponible.',
      '',
      'Actions à entreprendre',
      ai.actions.length ? ai.actions.map(item => `• ${item}`).join('\n') : 'Aucune action identifiée.'
    ].join('\n');
    return { title, body, eventType: call.direction === 'inbound' ? '49' : '50', call, ai };
  }

  async function createModulrNote(clientId, note) {
    const body = new URLSearchParams();
    const values = {
      mcut: '', action: 'send', mode: 'create', entity_id: String(clientId), class_name: 'Client',
      'task[task_id]': '', create_tour: '0', task_mode: 'simple_event', add_following_task: '', selectItemadd_following_task: '',
      'task[name]': '', 'task[recall_date]': '', 'task[recall_hour]': '', task_actors_list_id: '0', selectItemtask_actors_list_id: '0',
      selectGrouptask_actors_list_id: '', 'task[event_type]': note.eventType, 'selectItemtask[event_type]': note.eventType,
      model_message: '0', selectItemmodel_message: '0', message_template_type: 'event', task_related_to_entity: '0', selectItemtask_related_to_entity: '0',
      'task[call_id]': String(note.call.id || ''), 'task[call_qualification]': '', 'selectItemtask[call_qualification]': '', 'task[notes]': note.body
    };
    for (const [key, value] of Object.entries(values)) body.append(key, value);
    const response = await fetch('/fr/scripts/Tasks/TasksManage.php', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json, text/javascript, */*; q=0.01' },
      body: body.toString()
    });
    if (!response.ok) throw new Error(`ModulR HTTP ${response.status}`);
    return response.text();
  }

  function section(label, content) {
    return `<div style="padding:12px 14px;border:1px solid #e2e8f0;border-radius:8px;background:#fff"><div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#64748b;margin-bottom:6px">${esc(label)}</div><div style="white-space:pre-wrap;line-height:1.45;color:#334155">${esc(content || 'Non disponible.')}</div></div>`;
  }

  async function previewAndImport(call) {
    const detail = await api(`/api/calls/${encodeURIComponent(call.id)}`);
    const note = buildNote(detail);
    const modal = createModal('Prévisualisation avant import', `
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin-bottom:14px">
        <div><div style="font-size:18px;font-weight:700;color:#1e293b">${esc(note.title)}</div><div style="margin-top:4px;color:#64748b">${esc(note.call.direction === 'inbound' ? 'Appel entrant' : 'Appel sortant')} · ${esc(formatDuration(note.call.duration))} · ${esc(note.call.raw_digits || '')}</div></div>
        <span style="padding:5px 9px;border-radius:999px;background:#eef2f6;color:#475569;font-size:12px">Type ModulR ${note.eventType === '49' ? 'Appel entrant' : 'Appel sortant'}</span>
      </div>
      <div style="display:grid;gap:10px">
        ${section('Résumé de l’échange', note.ai.summary || 'Analyse Aircall en cours ou non disponible.')}
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">${section('Qualité', note.ai.quality || 'Non disponible.')}${section('Sentiment', note.ai.sentiment || 'Non disponible.')}</div>
        ${section('Sujets abordés', note.ai.topics.length ? note.ai.topics.map(v => `• ${v}`).join('\n') : 'Non disponible.')}
        ${section('Actions à entreprendre', note.ai.actions.length ? note.ai.actions.map(v => `• ${v}`).join('\n') : 'Aucune action identifiée.')}
      </div>
      <details style="margin-top:12px"><summary style="cursor:pointer;color:#64748b">Voir le texte exact enregistré dans ModulR</summary><pre style="white-space:pre-wrap;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;font-family:Arial,sans-serif;line-height:1.45">${esc(note.body)}</pre></details>
      <div style="display:flex;justify-content:flex-end;margin-top:16px"><button type="button" id="aircall-import-confirm" style="padding:9px 16px;border:0;border-radius:6px;background:#4f7892;color:#fff;font-weight:700;cursor:pointer">Créer l’événement dans ModulR</button></div>`);
    modal.querySelector('#aircall-import-confirm').onclick = async event => {
      const button = event.currentTarget;
      button.disabled = true;
      button.textContent = 'Création…';
      try {
        await createModulrNote(getClientId(), note);
        modal.remove();
        alert(`${note.eventType === '49' ? 'Appel entrant' : 'Appel sortant'} créé dans ModulR.`);
        location.reload();
      } catch (error) {
        alert(`Erreur création événement ModulR : ${error.message}`);
        button.disabled = false;
        button.textContent = 'Créer l’événement dans ModulR';
      }
    };
  }

  async function run(button) {
    const clientId = getClientId();
    if (!clientId) return alert('Impossible d’identifier la fiche client ModulR.');
    const pagePhones = getPhonesOnPage();
    const phones = await phoneSourcePicker(pagePhones);
    if (!phones?.length) return;
    const collaborator = await collaboratorPicker(phones);
    if (!collaborator) return;

    const initial = button.textContent;
    button.disabled = true;
    button.textContent = '…';
    try {
      const result = await api(`/api/calls?phones=${encodeURIComponent(phones.join(','))}&hours=${HOURS}`);
      const allCalls = Array.isArray(result.calls) ? result.calls : [];
      const wanted = normalizeName(collaborator.aircall);
      const calls = allCalls.filter(call => normalizeName(call.user?.name) === wanted);
      if (!calls.length) {
        alert(`Aucun appel Aircall de ${collaborator.modulr} trouvé sur les ${HOURS} dernières heures pour le(s) numéro(s) sélectionné(s).`);
        return;
      }
      const selected = calls.length === 1 ? calls[0] : await chooseCall(calls, collaborator);
      if (selected) await previewAndImport(selected);
    } catch (error) {
      alert(`Aircall : ${error.message}`);
    } finally {
      button.disabled = false;
      button.textContent = initial;
    }
  }

  function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  }

  function normalizeText(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function findEventsTitle() {
    return [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,div,span,strong,label')]
      .filter(isVisible)
      .find(el => {
        const own = [...el.childNodes].filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.textContent).join(' ');
        const text = normalizeText(own || el.textContent);
        return text === 'evenements' || text.startsWith('evenements ');
      }) || null;
  }

  function isPlusControl(el) {
    if (!isVisible(el)) return false;
    const text = normalizeText(el.textContent);
    const meta = normalizeText(`${el.id || ''} ${el.className || ''} ${el.title || ''} ${el.getAttribute?.('aria-label') || ''}`);
    return text === '+' || Boolean(el.querySelector?.('.fa-plus,.glyphicon-plus,[class*="plus"],[class*="add"]')) || /(^| )(plus|add|ajout|create|new)( |$)/.test(meta);
  }

  function findEventsPlus() {
    const title = findEventsTitle();
    const controls = [...document.querySelectorAll('button,a,[role="button"]')].filter(isPlusControl);
    if (!controls.length) return null;
    if (!title) return controls[0];
    const tr = title.getBoundingClientRect();
    return controls
      .map(el => {
        const r = el.getBoundingClientRect();
        const vertical = Math.abs((r.top + r.height / 2) - (tr.top + tr.height / 2));
        const horizontal = Math.abs(r.left - tr.right);
        return { el, score: vertical * 5 + horizontal };
      })
      .sort((a, b) => a.score - b.score)[0]?.el || null;
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
    button.textContent = '☎';
    button.style.cssText = 'width:36px;height:36px;margin:0 4px;border:0;border-radius:3px;background:#5f86a1;color:#fff;font-size:19px;font-weight:700;line-height:36px;text-align:center;cursor:pointer;vertical-align:middle';
    button.onclick = () => run(button);
    plus.parentElement.insertBefore(button, plus);
  }

  new MutationObserver(injectButton).observe(document.documentElement, { childList: true, subtree: true });
  injectButton();
  setTimeout(injectButton, 1000);
  setTimeout(injectButton, 2500);
  setTimeout(injectButton, 5000);
})();