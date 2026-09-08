const API = '/api';
let token = localStorage.getItem('adc_token');
let currentUser = null;

const $ = (sel) => document.querySelector(sel);
const money = (n) => Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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

function showError(el, msg) { el.innerHTML = `<div class="error-msg">${msg}</div>`; }
function showSuccess(el, msg) { el.innerHTML = `<div class="success-msg">${msg}</div>`; }
function escapeHtml(str = '') { return String(str).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c])); }
function setBusy(btn, busy, label) {
  if (!btn) return;
  if (busy) { btn.dataset.orig = btn.textContent; btn.textContent = label || 'Un momento…'; btn.disabled = true; }
  else { btn.textContent = btn.dataset.orig || btn.textContent; btn.disabled = false; }
}

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
    if (user.role !== 'admin') throw new Error('Esta cuenta no tiene permisos de administrador');
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
  localStorage.removeItem('adc_token'); location.reload();
});

$('#forgotLink').addEventListener('click', (e) => {
  e.preventDefault();
  $('#loginView').style.display = 'none';
  $('#recoverView').style.display = 'flex';
});
$('#backToLoginLink').addEventListener('click', (e) => {
  e.preventDefault();
  $('#recoverView').style.display = 'none';
  $('#loginView').style.display = 'flex';
});

$('#recoverForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = $('#recoverError'); errEl.innerHTML = '';
  $('#recoverSuccess').innerHTML = '';
  const btn = e.target.querySelector('button[type="submit"]');
  setBusy(btn, true, 'Restableciendo…');
  try {
    await api('/auth/recover', {
      method: 'POST',
      body: {
        username: $('#rc-user').value.trim(),
        recoveryKey: $('#rc-key').value,
        newPassword: $('#rc-newpass').value
      }
    });
    showSuccess($('#recoverSuccess'), 'Contraseña restablecida. Ya puedes iniciar sesión con la nueva.');
    e.target.reset();
  } catch (err) {
    showError(errEl, err.message);
  } finally {
    setBusy(btn, false);
  }
});

async function tryAutoLogin() {
  if (!token) return;
  try {
    const me = await api('/auth/me');
    if (me.role !== 'admin') return;
    currentUser = me;
    await enterApp();
  } catch { localStorage.removeItem('adc_token'); token = null; }
}

async function enterApp() {
  $('#loginView').style.display = 'none';
  $('#recoverView').style.display = 'none';
  $('#appView').style.display = 'block';
  $('#whoami').textContent = currentUser.username;
  $('#ma-user').value = currentUser.username;
  await Promise.all([loadUsers(), loadOffers(), loadContracts(), loadQuinielasAdminList()]);
}

let allUsers = [];

async function loadUsers() {
  allUsers = await api('/admin/users');
  renderUsers(allUsers);
}

function renderUsers(list) {
  $('#usersTable tbody').innerHTML = list.map(u => `
    <tr>
      <td>${escapeHtml(u.username)}</td>
      <td>${u.role}</td>
      <td><button class="btn btn-ghost btn-sm" onclick="resetPassword('${u.id}','${escapeAttr(u.username)}')">Restablecer contraseña</button></td>
    </tr>`).join('') || '<tr><td colspan="3">Sin usuarios</td></tr>';
}

$('#userSearch').addEventListener('input', (e) => {
  const q = e.target.value.trim().toLowerCase();
  renderUsers(q ? allUsers.filter(u => u.username.toLowerCase().includes(q)) : allUsers);
});

window.resetPassword = async (userId, username) => {
  const newPass = prompt(`Nueva contraseña para "${username}" (mínimo 4 caracteres):`);
  if (!newPass) return;
  if (newPass.length < 4) { alert('La contraseña debe tener al menos 4 caracteres'); return; }
  try {
    await api(`/admin/users/${userId}/reset-password`, { method: 'PATCH', body: { newPassword: newPass } });
    alert(`Listo, la contraseña de "${username}" se actualizó.`);
  } catch (err) {
    alert('No se pudo restablecer: ' + err.message);
  }
};

function escapeAttr(str = '') { return escapeHtml(str).replace(/'/g, '&#39;'); }

async function loadContracts() {
  const contracts = await api('/admin/contracts');
  $('#contractsTable tbody').innerHTML = contracts.map(c => `
    <tr>
      <td>
        <label class="switch">
          <input type="checkbox" ${c.paid ? 'checked' : ''} onchange="togglePaid('${c.ticket}', this.checked)">
          <span class="switch-track"></span>
        </label>
      </td>
      <td><span class="ticket">${c.ticket}</span></td>
      <td>${escapeHtml(c.description)}</td>
      <td>${escapeHtml(c.creatorUsername)}</td>
      <td>${escapeHtml(c.takerUsername)}</td>
      <td>$${money(c.amount)}${c.payoutMultiplier > 1 ? ` (x${c.payoutMultiplier})` : ''}</td>
    </tr>`).join('') || '<tr><td colspan="6">Todavía nadie ha tomado ninguna apuesta</td></tr>';
}

window.togglePaid = async (ticket, paid) => {
  try {
    await api(`/admin/contracts/${ticket}/paid`, { method: 'PATCH', body: { paid } });
  } catch (err) {
    alert('No se pudo actualizar: ' + err.message);
    await loadContracts();
  }
};

$('#exportExcelBtn').addEventListener('click', () => {
  const url = API + '/admin/contracts/export';
  fetch(url, { headers: { Authorization: 'Bearer ' + token } })
    .then(res => { if (!res.ok) throw new Error('No se pudo generar el Excel'); return res.blob(); })
    .then(blob => {
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = 'apuestas-de-caballeros-archivo.xlsx';
      link.click();
      URL.revokeObjectURL(link.href);
    })
    .catch(err => alert(err.message));
});

$('#clearPaidBtn').addEventListener('click', async () => {
  if (!confirm('¿Ya descargaste el Excel? Esto va a borrar del sistema (de forma permanente) todas las apuestas ya marcadas como pagadas.')) return;
  try {
    const { removed } = await api('/admin/contracts/archive-paid', { method: 'DELETE' });
    alert(`Se limpiaron ${removed} apuestas pagadas del archivo.`);
    await loadContracts();
  } catch (err) {
    alert('No se pudo limpiar: ' + err.message);
  }
});

async function loadOffers() {
  const offers = await api('/admin/offers');
  $('#offersTable tbody').innerHTML = offers.map(o => `
    <tr>
      <td><span class="ticket">${o.ticket}</span></td>
      <td>${escapeHtml(o.description)}</td>
      <td>${escapeHtml(o.creatorUsername)}</td>
      <td>$${money(o.amount)}</td>
      <td>${o.copiesTaken}/${o.maxCopies}</td>
      <td>${o.status === 'open' ? 'Abierta' : (o.status === 'full' ? 'Cupo lleno' : 'Cancelada')}</td>
      <td><button class="btn btn-ghost btn-sm" onclick="deleteOffer('${o.ticket}')">Borrar</button></td>
    </tr>`).join('') || '<tr><td colspan="7">Sin apuestas todavía</td></tr>';
}

window.deleteOffer = async (ticket) => {
  if (!confirm('¿Borrar esta apuesta? No se puede deshacer.')) return;
  try {
    await api(`/admin/offers/${ticket}`, { method: 'DELETE' });
    await loadOffers();
  } catch (err) {
    alert('No se pudo borrar: ' + err.message);
  }
};

$('#createUserForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = $('#createUserError'); errEl.innerHTML = '';
  $('#createUserSuccess').innerHTML = '';
  const btn = e.target.querySelector('button[type="submit"]');
  setBusy(btn, true, 'Creando…');
  try {
    const username = $('#nu-user').value.trim();
    await api('/admin/users', {
      method: 'POST',
      body: { username, password: $('#nu-pass').value, role: $('#nu-role').value }
    });
    e.target.reset();
    showSuccess($('#createUserSuccess'), `Usuario "${escapeHtml(username)}" creado correctamente. Ya puede iniciar sesión desde cualquier dispositivo.`);
    await loadUsers();
  } catch (err) {
    showError(errEl, err.message);
  } finally {
    setBusy(btn, false);
  }
});

$('#myAccountForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = $('#myAccountError'); errEl.innerHTML = '';
  $('#myAccountSuccess').innerHTML = '';
  const btn = e.target.querySelector('button[type="submit"]');
  setBusy(btn, true, 'Guardando…');
  try {
    const { token: t, user } = await api('/auth/me', {
      method: 'PATCH',
      body: {
        newUsername: $('#ma-user').value.trim(),
        newPassword: $('#ma-newpass').value || undefined,
        currentPassword: $('#ma-currentpass').value
      }
    });
    token = t; localStorage.setItem('adc_token', t);
    currentUser = user;
    $('#ma-currentpass').value = ''; $('#ma-newpass').value = '';
    $('#whoami').textContent = currentUser.username;
    showSuccess($('#myAccountSuccess'), 'Tus credenciales se actualizaron correctamente.');
    await loadUsers();
  } catch (err) {
    showError(errEl, err.message);
  } finally {
    setBusy(btn, false);
  }
});

// ---------------- Quinielas ----------------
let qnMatchRowCount = 0;
const MAX_MATCHES = 20;

function addMatchRow(local = '', visita = '') {
  if (qnMatchRowCount >= MAX_MATCHES) return;
  qnMatchRowCount++;
  const idx = qnMatchRowCount;
  const row = document.createElement('div');
  row.className = 'match-row';
  row.dataset.rowId = idx;
  row.innerHTML = `
    <div style="display:flex; gap:8px; flex:1;">
      <input placeholder="Local" class="qn-local" value="${escapeAttr(local)}" style="flex:1;">
      <input placeholder="Visita" class="qn-visita" value="${escapeAttr(visita)}" style="flex:1;">
    </div>
    <button type="button" class="btn btn-ghost btn-sm" onclick="this.closest('.match-row').remove(); updateMatchCountLabel();">✕</button>
  `;
  $('#qnMatchesInputs').appendChild(row);
  updateMatchCountLabel();
}

function updateMatchCountLabel() {
  const count = $('#qnMatchesInputs').children.length;
  $('#matchCountLabel').textContent = `${count}/${MAX_MATCHES} partidos`;
}

$('#addMatchBtn').addEventListener('click', () => addMatchRow());
// Arranca con 3 partidos vacíos para no partir de cero
addMatchRow(); addMatchRow(); addMatchRow();

$('#createQuinielaForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = $('#createQuinielaError'); errEl.innerHTML = '';
  $('#createQuinielaSuccess').innerHTML = '';
  const rows = [...$('#qnMatchesInputs').children];
  const matches = rows.map(r => ({
    local: r.querySelector('.qn-local').value.trim(),
    visita: r.querySelector('.qn-visita').value.trim()
  }));
  if (matches.some(m => !m.local || !m.visita)) {
    showError(errEl, 'Completa el local y la visita de todos los partidos, o bórralos.');
    return;
  }
  const btn = e.target.querySelector('button[type="submit"]');
  setBusy(btn, true, 'Creando…');
  try {
    await api('/admin/quinielas', { method: 'POST', body: { name: $('#qn-name').value.trim(), matches } });
    showSuccess($('#createQuinielaSuccess'), 'Quiniela creada correctamente. Ya está disponible para los usuarios.');
    e.target.reset();
    $('#qnMatchesInputs').innerHTML = '';
    qnMatchRowCount = 0;
    addMatchRow(); addMatchRow(); addMatchRow();
    await loadQuinielasAdminList();
  } catch (err) {
    showError(errEl, err.message);
  } finally {
    setBusy(btn, false);
  }
});

async function loadQuinielasAdminList() {
  const listEl = $('#quinielasAdminList');
  try {
    const quinielas = await api('/admin/quinielas');
    listEl.innerHTML = quinielas.length === 0
      ? '<p class="empty-state">Todavía no has creado ninguna quiniela.</p>'
      : quinielas.map(q => `
        <div class="quiniela-card">
          <div class="slip-top">
            <div class="slip-desc">${escapeHtml(q.name)}</div>
          </div>
          <div class="helptext" style="margin-bottom:10px;">${q.matchCount} partidos · ${q.entryCount} entrada${q.entryCount === 1 ? '' : 's'}${q.resultsCaptured ? ' · resultados capturados' : ' · sin resultados aún'}</div>
          <button class="btn btn-primary btn-sm" onclick="openQuinielaAdmin('${q.id}')">Ver detalle</button>
        </div>
      `).join('');
  } catch (err) {
    showError(listEl, err.message);
  }
}

let currentAdminQuinielaId = null;

window.openQuinielaAdmin = async (id) => {
  currentAdminQuinielaId = id;
  $('#quinielasListView').style.display = 'none';
  $('#quinielaAdminDetail').style.display = 'block';
  await refreshQuinielaAdminDetail();
};

$('#backToQuinielasAdminBtn').addEventListener('click', () => {
  $('#quinielaAdminDetail').style.display = 'none';
  $('#quinielasListView').style.display = 'block';
  loadQuinielasAdminList();
});

async function refreshQuinielaAdminDetail() {
  const q = await api(`/admin/quinielas/${currentAdminQuinielaId}`);
  $('#qnDetailName').textContent = q.name;

  $('#qnResultsMatches').innerHTML = q.matches.map((m, i) => `
    <div class="match-row">
      <div class="match-teams">${i + 1}. ${escapeHtml(m.local)}<span class="vs">vs</span>${escapeHtml(m.visita)}</div>
      <div class="pick-group">
        <button type="button" class="pick-btn ${q.results[i] === 'L' ? 'selected' : ''}" data-i="${i}" data-pick="L" onclick="setResultPick(${i},'L')">L</button>
        <button type="button" class="pick-btn ${q.results[i] === 'E' ? 'selected' : ''}" data-i="${i}" data-pick="E" onclick="setResultPick(${i},'E')">E</button>
        <button type="button" class="pick-btn ${q.results[i] === 'V' ? 'selected' : ''}" data-i="${i}" data-pick="V" onclick="setResultPick(${i},'V')">V</button>
      </div>
    </div>
  `).join('');
  window.currentResultsPicks = q.results.slice();

  await loadQuinielaEntries();
  await loadQuinielaRanking();
}

window.setResultPick = (i, pick) => {
  window.currentResultsPicks[i] = pick;
  document.querySelectorAll(`#qnResultsMatches .pick-btn[data-i="${i}"]`).forEach(b => {
    b.classList.toggle('selected', b.dataset.pick === pick);
  });
};

$('#saveResultsBtn').addEventListener('click', async () => {
  const results = window.currentResultsPicks || [];
  if (results.some(r => !r)) { alert('Captura L, E o V en todos los partidos antes de guardar.'); return; }
  try {
    await api(`/admin/quinielas/${currentAdminQuinielaId}/results`, { method: 'POST', body: { results } });
    alert('Resultados guardados. Ya se calcularon los aciertos.');
    await refreshQuinielaAdminDetail();
  } catch (err) {
    alert('No se pudo guardar: ' + err.message);
  }
});

async function loadQuinielaEntries() {
  const entries = await api(`/admin/quinielas/${currentAdminQuinielaId}/entries`);
  $('#qnEntriesTable tbody').innerHTML = entries.map(e => `
    <tr>
      <td>${escapeHtml(e.username)}</td>
      <td><span class="ticket">${e.code}</span></td>
      <td>${e.hits === null ? '—' : e.hits}</td>
      <td><button class="btn btn-ghost btn-sm" onclick="viewQuinielaEntry('${e.id}')">Ver quiniela</button></td>
    </tr>
  `).join('') || '<tr><td colspan="4">Nadie ha llenado esta quiniela todavía</td></tr>';
}

window.viewQuinielaEntry = async (entryId) => {
  try {
    const detail = await api(`/admin/quinielas/${currentAdminQuinielaId}/entries/${entryId}`);
    $('#qnEntryModalTitle').textContent = `${detail.username} — ${detail.code}`;
    $('#qnEntryModalBody').innerHTML = `
      <p class="helptext">Enviada: ${new Date(detail.createdAt).toLocaleString('es-MX')}</p>
      ${detail.matches.map((m, i) => `
        <div class="match-row">
          <div class="match-teams">${i + 1}. ${escapeHtml(m.local)}<span class="vs">vs</span>${escapeHtml(m.visita)}</div>
          <div>
            <span class="status-badge status-tomada">${detail.picks[i]}</span>
            ${detail.results ? (detail.results[i] === detail.picks[i] ? ' ✅' : ' ❌') : ''}
          </div>
        </div>
      `).join('')}
      ${detail.hits !== null ? `<p style="margin-top:10px;"><b>Aciertos: ${detail.hits}</b></p>` : ''}
    `;
    $('#quinielaEntryModal').style.display = 'flex';
  } catch (err) {
    alert('No se pudo cargar: ' + err.message);
  }
};
$('#closeQnEntryModalBtn').addEventListener('click', () => { $('#quinielaEntryModal').style.display = 'none'; });

async function loadQuinielaRanking() {
  const { resultsCaptured, ranking } = await api(`/admin/quinielas/${currentAdminQuinielaId}/ranking`);
  if (!resultsCaptured) {
    $('#qnRankingTable tbody').innerHTML = '<tr><td colspan="4">Captura los resultados primero para ver el ranking</td></tr>';
    return;
  }
  $('#qnRankingTable tbody').innerHTML = ranking.map((r, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${escapeHtml(r.username)}</td>
      <td>${r.hits}</td>
      <td>${r.isWinner ? '🏆' : ''}</td>
    </tr>
  `).join('') || '<tr><td colspan="4">Sin entradas</td></tr>';
}

$('#exportRankingBtn').addEventListener('click', () => {
  fetch(`${API}/admin/quinielas/${currentAdminQuinielaId}/ranking/export`, { headers: { Authorization: 'Bearer ' + token } })
    .then(res => { if (!res.ok) throw new Error('No se pudo generar el Excel'); return res.blob(); })
    .then(blob => {
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = 'ranking-quiniela.xlsx';
      link.click();
      URL.revokeObjectURL(link.href);
    })
    .catch(err => alert(err.message));
});

$('#deleteQuinielaBtn').addEventListener('click', async () => {
  if (!confirm('¿Borrar esta quiniela? Se borrarán también todas las entradas de los usuarios. No se puede deshacer.')) return;
  try {
    await api(`/admin/quinielas/${currentAdminQuinielaId}`, { method: 'DELETE' });
    $('#quinielaAdminDetail').style.display = 'none';
    $('#quinielasListView').style.display = 'block';
    await loadQuinielasAdminList();
  } catch (err) {
    alert('No se pudo borrar: ' + err.message);
  }
});

tryAutoLogin();
