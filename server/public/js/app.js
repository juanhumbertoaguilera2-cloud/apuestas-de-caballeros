const API = '/api';
let token = localStorage.getItem('adc_token');
let currentUser = null;

const $ = (sel) => document.querySelector(sel);
function money(n) { return Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function showError(el, msg) { el.innerHTML = `<div class="error-msg">${msg}</div>`; }
function escapeHtml(str = '') { return String(str).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c])); }

async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(opts.headers || {})
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Error de servidor');
  return data;
}

function setBusy(btn, busy, label) {
  if (!btn) return;
  if (busy) { btn.dataset.orig = btn.textContent; btn.textContent = label || 'Un momento…'; btn.disabled = true; }
  else { btn.textContent = btn.dataset.orig || btn.textContent; btn.disabled = false; }
}

function showTicketModal(title, code, desc) {
  $('#ticketModalTitle').textContent = title;
  $('#ticketModalCode').textContent = code;
  $('#ticketModalDesc').textContent = desc;
  $('#ticketModal').style.display = 'flex';
}
window.closeTicketModal = () => { $('#ticketModal').style.display = 'none'; };

// ---------------- Login ----------------
$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = $('#loginError'); errEl.innerHTML = '';
  const btn = e.target.querySelector('button[type="submit"]');
  setBusy(btn, true, 'Entrando…');
  try {
    const { token: t, user } = await api('/auth/login', {
      method: 'POST',
      body: { username: $('#loginUser').value.trim(), password: $('#loginPass').value }
    });
    if (user.role !== 'user') throw new Error('Esta cuenta es de administrador. Entra desde admin.html');
    token = t; localStorage.setItem('adc_token', t);
    currentUser = user;
    await enterApp();
  } catch (err) {
    showError(errEl, err.message);
  } finally {
    setBusy(btn, false);
  }
});

$('#logoutBtn').addEventListener('click', () => {
  localStorage.removeItem('adc_token'); token = null; location.reload();
});

async function tryAutoLogin() {
  if (!token) return;
  try {
    const me = await api('/auth/me');
    if (me.role !== 'user') return;
    currentUser = me;
    await enterApp();
  } catch { localStorage.removeItem('adc_token'); token = null; }
}

async function enterApp() {
  $('#loginView').style.display = 'none';
  $('#appView').style.display = 'block';
  $('#whoami').textContent = currentUser.username;
  await renderMarket();
}

// ---------------- Tabs ----------------
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    $('#tab-' + btn.dataset.tab).classList.add('active');
    if (btn.dataset.tab === 'market') await renderMarket();
    if (btn.dataset.tab === 'create') await updateAutocompleteLists();
    if (btn.dataset.tab === 'mine') await renderMine();
    if (btn.dataset.tab === 'quinielas') await renderQuinielasList();
  });
});

async function updateAutocompleteLists() {
  try {
    const { descriptions, sides } = await api('/bets/suggestions');
    $('#descList').innerHTML = descriptions.map(d => `<option value="${escapeHtml(d)}">`).join('');
    $('#sideList').innerHTML = sides.map(s => `<option value="${escapeHtml(s)}">`).join('');
  } catch { /* no bloquea el formulario si falla */ }
}

// Cuánto ganarías si tomas/ganas una apuesta: tu monto de vuelta + 90% del
// monto de tu contraparte (comisión de la casa ya descontada), o si la
// apuesta tiene pago x2/x3, ese monto completo (así se ofreció el pago).
function computeWinAmount(amount, multiplier) {
  if (multiplier && multiplier > 1) return amount * multiplier;
  return amount + amount * 0.9;
}

// En caso de empate, a cada quien se le regresa su monto menos el 5% de
// comisión de la casa (mismo trato para ambos, sin importar el multiplicador).
function computeTieAmount(amount) {
  return amount * 0.95;
}

// ---------------- Mercado ----------------
async function renderMarket() {
  const listEl = $('#marketList');
  listEl.innerHTML = '<p class="empty-state">Cargando apuestas…</p>';
  try {
    const offers = await api('/bets');
    if (offers.length === 0) { listEl.innerHTML = '<p class="empty-state">No hay apuestas disponibles ahora mismo.</p>'; return; }
    listEl.innerHTML = offers.map(o => `
      <div class="slip">
        <span class="slip-category">${escapeHtml(o.category)} · <span class="ticket">${o.ticket}</span>${o.payoutMultiplier > 1 ? ` · <span class="status-badge status-tomada">Pago x${o.payoutMultiplier}</span>` : ''}</span>
        <div class="slip-top">
          <div class="slip-desc">${escapeHtml(o.description)}</div>
          <div class="amount">$${money(o.amount)}</div>
        </div>
        <div class="helptext" style="margin-bottom:8px;">Apuesta de <b>${escapeHtml(o.creatorUsername)}</b>: "${escapeHtml(o.side)}"${o.payoutMultiplier > 1 ? ` — si pierde, paga ${o.payoutMultiplier}x` : ''}</div>
        <div class="win-preview">Si tomas esta apuesta y ganas, recibirías: <b>$${money(computeWinAmount(o.amount, o.payoutMultiplier))}</b><br>Si hay empate, recibes: <b>$${money(computeTieAmount(o.amount))}</b></div>
        <div class="slip-meta" style="margin-top:10px;"><span>Cupo: <b>${o.copiesTaken}/${o.maxCopies}</b></span></div>
        <div style="margin-top:10px;"><button class="btn btn-danger btn-sm" onclick="takeOffer('${o.ticket}','${escapeAttr(o.side)}')">Tomar esta apuesta</button></div>
      </div>
    `).join('');
  } catch (err) {
    showError(listEl, err.message);
  }
}

window.takeOffer = async function (ticket, creatorSide) {
  const takerSide = prompt(`El creador apostó a: "${creatorSide}".\n¿Qué lado tomas tú? (déjalo en blanco para "lo contrario")`);
  try {
    const contract = await api(`/bets/${ticket}/take`, { method: 'POST', body: { takerSide: takerSide || undefined } });
    await renderMarket();
    showTicketModal('¡Apuesta tomada!', contract.ticket, `Este es el ticket del contrato entre ${contract.creatorUsername} y ${contract.takerUsername}. El depósito y liquidación se manejan por fuera, por ahora.`);
  } catch (err) {
    alert('No se pudo tomar la apuesta: ' + err.message);
  }
};

// ---------------- Registrar ----------------
$('#createForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = $('#createError'); errEl.innerHTML = '';
  const amountValue = Number($('#c-amount').value);
  if (!(amountValue >= 20)) {
    showError(errEl, 'La apuesta mínima es de $20 pesos.');
    return;
  }
  const btn = e.target.querySelector('button[type="submit"]');
  setBusy(btn, true, 'Registrando…');
  try {
    const payoutMultiplier = $('#c-triple').checked ? 3 : ($('#c-double').checked ? 2 : 1);
    const offer = await api('/bets', {
      method: 'POST',
      body: {
        category: $('#c-category').value.trim(),
        description: $('#c-desc').value.trim(),
        side: $('#c-side').value.trim(),
        amount: amountValue,
        maxCopies: Number($('#c-copies').value),
        payoutMultiplier
      }
    });
    e.target.reset();
    $('#c-category').value = 'Fútbol'; $('#c-copies').value = 1;
    $('#c-double').checked = false; $('#c-triple').checked = false;
    $('#winPreview').style.display = 'none';
    showTicketModal('¡Apuesta registrada!', offer.ticket, 'Guarda este folio. Cuando alguien la tome, recibirán un ticket de contrato. Ya es visible para todos los usuarios.');
  } catch (err) {
    showError(errEl, err.message);
  } finally {
    setBusy(btn, false);
  }
});

// ---------------- Mis apuestas ----------------
async function renderMine() {
  const offersEl = $('#myOffersList');
  const takenEl = $('#myTakenList');
  try {
    const { offers, contracts } = await api('/bets/mine/all');

    offersEl.innerHTML = offers.length === 0 ? '<p class="empty-state">Aún no has registrado apuestas.</p>' : offers.map(o => `
      <div class="slip">
        <span class="slip-category">${escapeHtml(o.category)} · <span class="ticket">${o.ticket}</span>${o.payoutMultiplier > 1 ? ` · <span class="status-badge status-tomada">Pago x${o.payoutMultiplier}</span>` : ''}</span>
        <div class="slip-top"><div class="slip-desc">${escapeHtml(o.description)}</div><div class="amount">$${money(o.amount)}</div></div>
        <div class="helptext" style="margin-bottom:8px;">Tu lado: "${escapeHtml(o.side)}"${o.payoutMultiplier > 1 ? ` — si pierdes, pagas ${o.payoutMultiplier}x` : ''}</div>
        <div class="slip-meta">
          <span>Cupo: <b>${o.copiesTaken}/${o.maxCopies}</b></span>
          <span class="status-badge status-${o.status === 'open' ? 'open' : (o.status==='full'?'full':'cancelada')}">${o.status === 'open' ? 'Abierta' : (o.status==='full'?'Cupo lleno':'Cancelada')}</span>
        </div>
        ${o.status === 'open' && o.copiesTaken === 0 ? `<div style="margin-top:10px;"><button class="btn btn-ghost btn-sm" onclick="cancelOffer('${o.ticket}')">Cancelar apuesta</button></div>` : ''}
      </div>
    `).join('');

    takenEl.innerHTML = contracts.length === 0 ? '<p class="empty-state">Aún no tienes contratos.</p>' : contracts.map(c => `
      <div class="slip ${c.role === 'taker' ? 'taker' : ''}">
        <span class="slip-category">${escapeHtml(c.category)} · <span class="ticket">${c.ticket}</span> · ${c.role === 'creator' ? 'Tú la registraste' : 'La tomaste'}${c.payoutMultiplier > 1 ? ` · <span class="status-badge status-tomada">Pago x${c.payoutMultiplier}</span>` : ''}</span>
        <div class="slip-top"><div class="slip-desc">${escapeHtml(c.description)}</div><div class="amount">$${money(c.amount)}</div></div>
        <div class="helptext">Contraparte: <b>${escapeHtml(c.counterpartUsername)}</b> — tu lado: "${escapeHtml(c.role==='creator'?c.creatorSide:c.takerSide)}"</div>
        <div class="slip-meta"><span class="status-badge status-tomada">Emparejada</span></div>
      </div>
    `).join('');
  } catch (err) {
    showError(offersEl, err.message);
  }
}

window.cancelOffer = async (ticket) => {
  if (!confirm('¿Cancelar esta apuesta? Nadie la ha tomado todavía.')) return;
  try {
    await api(`/bets/${ticket}`, { method: 'DELETE' });
    await renderMine();
  } catch (err) {
    alert('No se pudo cancelar: ' + err.message);
  }
};

function escapeAttr(str = '') { return escapeHtml(str).replace(/'/g, '&#39;'); }

// Pago al doble / pago al triple son mutuamente excluyentes
$('#c-double').addEventListener('change', () => { if ($('#c-double').checked) $('#c-triple').checked = false; updateWinPreview(); });
$('#c-triple').addEventListener('change', () => { if ($('#c-triple').checked) $('#c-double').checked = false; updateWinPreview(); });

// Vista previa de cuánto ganarías: tu monto de vuelta + 90% de lo que apostó
// tu contraparte (ya descontado el 5% de comisión de la casa de cada lado).
$('#c-amount').addEventListener('input', updateWinPreview);
function updateWinPreview() {
  const box = $('#winPreview');
  const amount = Number($('#c-amount').value);
  if (!amount || amount <= 0) { box.style.display = 'none'; return; }
  const multiplier = $('#c-triple').checked ? 3 : ($('#c-double').checked ? 2 : 1);
  let html = `Si ganas, recibirías: <b>$${money(computeWinAmount(amount, multiplier))}</b>`;
  html += `<br>Si hay empate, recibes: <b>$${money(computeTieAmount(amount))}</b>`;
  if (multiplier > 1) {
    html += `<br>Si pierdes, pagarías: <b>$${money(amount * multiplier)}</b> (pago x${multiplier})`;
  }
  box.innerHTML = html;
  box.style.display = 'block';
}

// ---------------- Quinielas ----------------
let currentQuinielaId = null;
let currentQuinielaPicks = [];

async function renderQuinielasList() {
  $('#quinielaDetailView').style.display = 'none';
  $('#quinielasListView').style.display = 'block';
  const listEl = $('#quinielasList');
  listEl.innerHTML = '<p class="empty-state">Cargando quinielas…</p>';
  try {
    const quinielas = await api('/quinielas');
    if (quinielas.length === 0) {
      listEl.innerHTML = '<p class="empty-state">Todavía no hay quinielas disponibles.</p>';
      return;
    }
    listEl.innerHTML = quinielas.map(q => `
      <div class="quiniela-card">
        <div class="slip-top">
          <div class="slip-desc">${escapeHtml(q.name)}</div>
        </div>
        <div class="helptext" style="margin-bottom:10px;">${q.matchCount} partido${q.matchCount === 1 ? '' : 's'}${q.resultsCaptured ? ' · resultados ya capturados' : ''}</div>
        ${q.myEntryCode
          ? `<span class="status-badge status-tomada">Ya la llenaste — código ${q.myEntryCode}</span>`
          : `<button class="btn btn-primary btn-sm" onclick="openQuiniela('${q.id}')">Llenar quiniela</button>`
        }
      </div>
    `).join('');
  } catch (err) {
    showError(listEl, err.message);
  }
}

window.openQuiniela = async (id) => {
  currentQuinielaId = id;
  try {
    const q = await api(`/quinielas/${id}`);
    $('#quinielaDetailName').textContent = q.name;
    $('#quinielasListView').style.display = 'none';
    $('#quinielaDetailView').style.display = 'block';

    if (q.myEntry) {
      $('#quinielaFilledView').style.display = 'block';
      $('#quinielaFormView').style.display = 'none';
      $('#quinielaFilledCode').textContent = q.myEntry.code;
      $('#downloadPdfAgainBtn').onclick = () => downloadQuinielaPdf(q.myEntry.id, q.myEntry.code);
    } else {
      $('#quinielaFilledView').style.display = 'none';
      $('#quinielaFormView').style.display = 'block';
      currentQuinielaPicks = new Array(q.matches.length).fill(null);
      $('#quinielaMatchesList').innerHTML = q.matches.map((m, i) => `
        <div class="match-row">
          <div class="match-teams">${i + 1}. ${escapeHtml(m.local)}<span class="vs">vs</span>${escapeHtml(m.visita)}</div>
          <div class="pick-group">
            <button type="button" class="pick-btn" data-i="${i}" data-pick="L" onclick="setPick(${i},'L')">L</button>
            <button type="button" class="pick-btn" data-i="${i}" data-pick="E" onclick="setPick(${i},'E')">E</button>
            <button type="button" class="pick-btn" data-i="${i}" data-pick="V" onclick="setPick(${i},'V')">V</button>
          </div>
        </div>
      `).join('');
    }
  } catch (err) {
    alert('No se pudo abrir la quiniela: ' + err.message);
  }
};

window.setPick = (i, pick) => {
  currentQuinielaPicks[i] = pick;
  document.querySelectorAll(`.pick-btn[data-i="${i}"]`).forEach(b => {
    b.classList.toggle('selected', b.dataset.pick === pick);
  });
};

$('#backToQuinielasBtn').addEventListener('click', renderQuinielasList);

$('#quinielaForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = $('#quinielaFormError'); errEl.innerHTML = '';
  if (currentQuinielaPicks.some(p => !p)) {
    showError(errEl, 'Selecciona L, E o V en todos los partidos.');
    return;
  }
  const btn = e.target.querySelector('button[type="submit"]');
  setBusy(btn, true, 'Enviando…');
  try {
    const entry = await api(`/quinielas/${currentQuinielaId}/entries`, {
      method: 'POST',
      body: { picks: currentQuinielaPicks }
    });
    await downloadQuinielaPdf(entry.id, entry.code);
    alert(`¡Quiniela enviada! Tu código es ${entry.code}. Se descargó tu comprobante en PDF.`);
    await openQuiniela(currentQuinielaId);
  } catch (err) {
    showError(errEl, err.message);
  } finally {
    setBusy(btn, false);
  }
});

async function downloadQuinielaPdf(entryId, code) {
  const res = await fetch(`${API}/quinielas/entries/${entryId}/pdf`, {
    headers: { Authorization: 'Bearer ' + token }
  });
  if (!res.ok) { alert('No se pudo descargar el PDF'); return; }
  const blob = await res.blob();
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `quiniela-${code}.pdf`;
  link.click();
  URL.revokeObjectURL(link.href);
}

tryAutoLogin();
