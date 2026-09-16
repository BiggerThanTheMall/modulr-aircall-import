from pathlib import Path

p = Path('modulr-aircall-import.user.js')
s = p.read_text(encoding='utf-8')

s = s.replace('// @version      1.1.0', '// @version      1.2.0', 1)
s = s.replace("const VERSION = '1.1.0';", "const VERSION = '1.2.0';", 1)

anchor = "  function collaboratorPicker(phones) {\n"
if anchor not in s:
    raise SystemExit('collaboratorPicker anchor not found')

new_fn = r'''  function phoneSourcePicker(pagePhones) {
    return new Promise(resolve => {
      const detected = [...new Set(pagePhones || [])];
      const phoneRows = detected.length
        ? detected.map((phone, index) => `
          <label style="display:flex;align-items:center;gap:9px;padding:9px 10px;border:1px solid #e2e8f0;border-radius:7px;background:#fff;margin-bottom:7px;cursor:pointer">
            <input type="checkbox" data-page-phone value="${esc(phone)}" checked style="width:16px;height:16px">
            <span style="font-weight:600;color:#334155">${esc(phone)}</span>
          </label>`).join('')
        : '<div style="padding:10px 12px;border:1px dashed #cbd5e1;border-radius:7px;color:#94a3b8">Aucun numéro détecté sur cette fiche.</div>';

      const modal = createModal('Choisir le numéro de l’appel', `
        <div style="margin-bottom:14px;color:#64748b">L’événement sera enregistré sur <strong style="color:#334155">${esc(getClientName())}</strong>. Choisissez simplement quel numéro Aircall rechercher.</div>

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
            <div style="font-size:12px;color:#64748b;margin-top:6px">Utile pour un banquier, avocat, compagnie, prestataire, pompe funèbre, etc.</div>
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

'''
s = s.replace(anchor, new_fn + anchor, 1)

s = s.replace("correspondant aux numéros de la fiche sur les ${HOURS} dernières heures.", "correspondant au(x) numéro(s) sélectionné(s) sur les ${HOURS} dernières heures.", 1)

old_run = r'''  async function run(button) {
    const clientId = getClientId();
    if (!clientId) return alert('Impossible d’identifier la fiche client ModulR.');
    const phones = getPhonesOnPage();
    if (!phones.length) return alert('Aucun numéro de téléphone exploitable trouvé sur cette fiche.');

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
        alert(`Aucun appel Aircall de ${collaborator.modulr} trouvé sur les ${HOURS} dernières heures pour les numéros de cette fiche.`);
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
'''

new_run = r'''  async function run(button) {
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
'''

if old_run not in s:
    raise SystemExit('run() block not found')
s = s.replace(old_run, new_run, 1)

if "phoneSourcePicker(pagePhones)" not in s:
    raise SystemExit('phone source picker not wired')
if "@version      1.2.0" not in s:
    raise SystemExit('version not bumped')

p.write_text(s, encoding='utf-8')
print('Phone source picker migration prepared')
