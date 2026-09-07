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
  await Promise.all([loadUsers(), loadOffers(), loadContracts()]);
}

async function loadUsers() {
  const users = await api('/admin/users');
  $('#usersTable tbody').innerHTML = users.map(u => `
    <tr>
      <td>${escapeHtml(u.username)}</td>
      <td>${u.role}</td>
      <td><button class="btn btn-ghost btn-sm" onclick="resetPassword('${u.id}','${escapeAttr(u.username)}')">Restablecer contraseña</button></td>
    </tr>`).join('') || '<tr><td colspan="3">Sin usuarios</td></tr>';
}

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
      <td><span class="ticket">${c.ticket}</span></td>
      <td>${escapeHtml(c.description)}</td>
      <td>${escapeHtml(c.creatorUsername)}</td>
      <td>${escapeHtml(c.takerUsername)}</td>
      <td>$${money(c.amount)}${c.payoutMultiplier > 1 ? ` (x${c.payoutMultiplier})` : ''}</td>
    </tr>`).join('') || '<tr><td colspan="5">Todavía nadie ha tomado ninguna apuesta</td></tr>';
}

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
    </tr>`).join('') || '<tr><td colspan="6">Sin apuestas todavía</td></tr>';
}

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

tryAutoLogin();
