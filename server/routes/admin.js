const express = require('express');
const bcrypt = require('bcryptjs');
const XLSX = require('xlsx');
const { readDb, writeDb } = require('../db');
const { authMiddleware, adminOnly, newId } = require('../utils');

const router = express.Router();
router.use(authMiddleware, adminOnly);

router.get('/users', (req, res) => {
  const db = readDb();
  res.json(db.users.map(u => ({ id: u.id, username: u.username, role: u.role, createdAt: u.createdAt })));
});

router.post('/users', (req, res) => {
  const { username, password, role } = req.body || {};
  if (!username || !username.trim()) return res.status(400).json({ error: 'Escribe un nombre de usuario' });
  if (!password || password.length < 4) return res.status(400).json({ error: 'La contraseña debe tener al menos 4 caracteres' });
  if (role && !['user', 'admin'].includes(role)) return res.status(400).json({ error: 'Rol inválido' });

  const db = readDb();
  if (db.users.some(u => u.username.toLowerCase() === username.trim().toLowerCase())) {
    return res.status(409).json({ error: 'Ese usuario ya existe' });
  }
  const newUser = {
    id: newId('u'),
    username: username.trim(),
    passwordHash: bcrypt.hashSync(password, 10),
    role: role || 'user',
    createdAt: new Date().toISOString()
  };
  db.users.push(newUser);
  writeDb(db);
  res.status(201).json({ id: newUser.id, username: newUser.username, role: newUser.role });
});

// Restablecer la contraseña de cualquier usuario (para cuando alguien la
// olvida). El admin no necesita la contraseña anterior, solo su propia sesión.
router.patch('/users/:id/reset-password', (req, res) => {
  const { newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 4) return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 4 caracteres' });
  const db = readDb();
  const user = db.users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  user.passwordHash = bcrypt.hashSync(newPassword, 10);
  writeDb(db);
  res.json({ ok: true });
});

// Todas las apuestas registradas en el sistema, para supervisión del admin
router.get('/offers', (req, res) => {
  const db = readDb();
  res.json(db.offers);
});

// Borrar cualquier apuesta disponible (no tomada), para no saturar el mercado.
// El admin puede borrar la de cualquier usuario, a diferencia del usuario
// normal que solo puede borrar las suyas.
router.delete('/offers/:ticket', (req, res) => {
  const db = readDb();
  const offer = db.offers.find(o => o.ticket === req.params.ticket);
  if (!offer) return res.status(404).json({ error: 'Apuesta no encontrada' });
  db.offers = db.offers.filter(o => o.ticket !== req.params.ticket);
  writeDb(db);
  res.json({ ok: true });
});

// Todas las apuestas ya tomadas (contratos), con quién apostó y quién tomó,
// para que el admin sepa a quién cobrarle o pagarle.
router.get('/contracts', (req, res) => {
  const db = readDb();
  res.json(db.contracts);
});

// Marcar (o desmarcar) un contrato como pagado por ambas partes.
router.patch('/contracts/:ticket/paid', (req, res) => {
  const { paid } = req.body || {};
  const db = readDb();
  const contract = db.contracts.find(c => c.ticket === req.params.ticket);
  if (!contract) return res.status(404).json({ error: 'Contrato no encontrado' });
  contract.paid = !!paid;
  contract.paidAt = paid ? new Date().toISOString() : null;
  writeDb(db);
  res.json(contract);
});

// Descargar un Excel con el archivo completo de apuestas (para respaldo,
// contabilidad, o antes de limpiar el archivo pagado).
router.get('/contracts/export', (req, res) => {
  const db = readDb();
  const rows = db.contracts.map(c => ({
    Ticket: c.ticket,
    Categoría: c.category,
    Descripción: c.description,
    Registró: c.creatorUsername,
    Tomó: c.takerUsername,
    Monto: c.amount,
    Multiplicador: c.payoutMultiplier || 1,
    Pagada: c.paid ? 'Sí' : 'No',
    'Fecha registro': c.createdAt,
    'Fecha pago': c.paidAt || ''
  }));
  const sheet = XLSX.utils.json_to_sheet(rows);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Apuestas');
  const buffer = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="apuestas-de-caballeros-archivo.xlsx"');
  res.send(buffer);
});

// Elimina del archivo activo los contratos ya marcados como pagados, para no
// acumular datos indefinidamente. Se recomienda exportar a Excel antes.
router.delete('/contracts/archive-paid', (req, res) => {
  const db = readDb();
  const before = db.contracts.length;
  db.contracts = db.contracts.filter(c => !c.paid);
  writeDb(db);
  res.json({ removed: before - db.contracts.length });
});

// ---------------------------------------------------------------------------
// Quinielas
// ---------------------------------------------------------------------------
const { buildQuinielaPdfBuffer, buildQuinielaReportPdfBuffer } = require('../pdf');

// Crear una quiniela: nombre + costo por boleto + hasta 20 partidos (local vs visita)
router.post('/quinielas', (req, res) => {
  const { name, matches, cost } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Ponle un nombre a la quiniela' });
  if (!Array.isArray(matches) || matches.length === 0) return res.status(400).json({ error: 'Agrega al menos 1 partido' });
  if (matches.length > 20) return res.status(400).json({ error: 'Máximo 20 partidos por quiniela' });
  if (!matches.every(m => m.local && m.local.trim() && m.visita && m.visita.trim())) {
    return res.status(400).json({ error: 'Todos los partidos necesitan equipo local y visita' });
  }
  const numCost = Number(cost) || 0;
  if (numCost < 0) return res.status(400).json({ error: 'El costo no puede ser negativo' });

  const db = readDb();
  const quiniela = {
    id: newId('quiniela'),
    name: name.trim(),
    cost: numCost,
    matches: matches.map((m, i) => ({ id: 'm' + (i + 1), local: m.local.trim(), visita: m.visita.trim() })),
    results: matches.map(() => null),
    createdAt: new Date().toISOString()
  };
  db.quinielas.push(quiniela);
  writeDb(db);
  res.status(201).json(quiniela);
});

// Listar todas las quinielas con cuántas entradas tiene cada una
router.get('/quinielas', (req, res) => {
  const db = readDb();
  const list = db.quinielas.map(q => ({
    id: q.id,
    name: q.name,
    cost: q.cost || 0,
    matchCount: q.matches.length,
    entryCount: db.quinielaEntries.filter(e => e.quinielaId === q.id).length,
    paidCount: db.quinielaEntries.filter(e => e.quinielaId === q.id && e.paid).length,
    resultsCaptured: q.results.every(r => r !== null),
    createdAt: q.createdAt
  }));
  res.json(list);
});

// Detalle de una quiniela (para capturar resultados)
router.get('/quinielas/:id', (req, res) => {
  const db = readDb();
  const q = db.quinielas.find(q => q.id === req.params.id);
  if (!q) return res.status(404).json({ error: 'Quiniela no encontrada' });
  res.json(q);
});

// Borrar una quiniela ya pasada (y todas sus entradas)
router.delete('/quinielas/:id', (req, res) => {
  const db = readDb();
  const exists = db.quinielas.some(q => q.id === req.params.id);
  if (!exists) return res.status(404).json({ error: 'Quiniela no encontrada' });
  db.quinielas = db.quinielas.filter(q => q.id !== req.params.id);
  db.quinielaEntries = db.quinielaEntries.filter(e => e.quinielaId !== req.params.id);
  writeDb(db);
  res.json({ ok: true });
});

// Capturar los resultados reales de cada partido (L/E/V), todos de una vez
router.post('/quinielas/:id/results', (req, res) => {
  const { results } = req.body || {};
  const db = readDb();
  const q = db.quinielas.find(q => q.id === req.params.id);
  if (!q) return res.status(404).json({ error: 'Quiniela no encontrada' });
  if (!Array.isArray(results) || results.length !== q.matches.length) {
    return res.status(400).json({ error: `Debes capturar los ${q.matches.length} resultados` });
  }
  if (!results.every(r => ['L', 'E', 'V'].includes(r))) {
    return res.status(400).json({ error: 'Cada resultado debe ser L, E o V' });
  }
  q.results = results;
  writeDb(db);
  res.json(q);
});

function countHits(picks, results) {
  return picks.reduce((sum, p, i) => sum + (results[i] && p === results[i] ? 1 : 0), 0);
}

// Todas las entradas de una quiniela, con aciertos si ya hay resultados
router.get('/quinielas/:id/entries', (req, res) => {
  const db = readDb();
  const q = db.quinielas.find(q => q.id === req.params.id);
  if (!q) return res.status(404).json({ error: 'Quiniela no encontrada' });
  const hasResults = q.results.every(r => r !== null);
  const entries = db.quinielaEntries
    .filter(e => e.quinielaId === q.id)
    .map(e => ({
      id: e.id,
      username: e.username,
      code: e.code,
      paid: !!e.paid,
      createdAt: e.createdAt,
      hits: hasResults ? countHits(e.picks, q.results) : null
    }));
  res.json(entries);
});

// Marcar (o desmarcar) una entrada de quiniela como pagada
router.patch('/quinielas/:id/entries/:entryId/paid', (req, res) => {
  const { paid } = req.body || {};
  const db = readDb();
  const entry = db.quinielaEntries.find(e => e.id === req.params.entryId && e.quinielaId === req.params.id);
  if (!entry) return res.status(404).json({ error: 'Entrada no encontrada' });
  entry.paid = !!paid;
  writeDb(db);
  res.json(entry);
});

// Detalle de una entrada específica (para el botón "Ver quiniela")
router.get('/quinielas/:id/entries/:entryId', (req, res) => {
  const db = readDb();
  const q = db.quinielas.find(q => q.id === req.params.id);
  if (!q) return res.status(404).json({ error: 'Quiniela no encontrada' });
  const entry = db.quinielaEntries.find(e => e.id === req.params.entryId && e.quinielaId === q.id);
  if (!entry) return res.status(404).json({ error: 'Entrada no encontrada' });
  const hasResults = q.results.every(r => r !== null);
  res.json({
    username: entry.username,
    code: entry.code,
    createdAt: entry.createdAt,
    matches: q.matches,
    picks: entry.picks,
    results: hasResults ? q.results : null,
    hits: hasResults ? countHits(entry.picks, q.results) : null
  });
});

// PDF de una entrada especifica (por si el admin necesita reimprimirlo)
router.get('/quinielas/:id/entries/:entryId/pdf', async (req, res) => {
  const db = readDb();
  const q = db.quinielas.find(q => q.id === req.params.id);
  if (!q) return res.status(404).json({ error: 'Quiniela no encontrada' });
  const entry = db.quinielaEntries.find(e => e.id === req.params.entryId && e.quinielaId === q.id);
  if (!entry) return res.status(404).json({ error: 'Entrada no encontrada' });
  try {
    const buffer = await buildQuinielaPdfBuffer(entry, q);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="quiniela-${entry.code}.pdf"`);
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: 'No se pudo generar el PDF' });
  }
});

// PDF de transparencia: lista de entradas (todas o solo pagadas) + pozo acumulado
router.get('/quinielas/:id/report-pdf', async (req, res) => {
  const filter = req.query.filter === 'paid' ? 'paid' : 'all';
  const db = readDb();
  const q = db.quinielas.find(q => q.id === req.params.id);
  if (!q) return res.status(404).json({ error: 'Quiniela no encontrada' });
  let entries = db.quinielaEntries.filter(e => e.quinielaId === q.id);
  if (filter === 'paid') entries = entries.filter(e => e.paid);
  const filterLabel = filter === 'paid' ? 'Solo entradas pagadas' : 'Todas las entradas';

  try {
    const buffer = await buildQuinielaReportPdfBuffer(q, entries, filterLabel);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="reporte-${filter}-${q.name.replace(/[^a-z0-9]/gi, '-')}.pdf"`);
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: 'No se pudo generar el PDF' });
  }
});

// Ranking de usuarios por aciertos (para saber quién(es) ganaron el premio)
router.get('/quinielas/:id/ranking', (req, res) => {
  const db = readDb();
  const q = db.quinielas.find(q => q.id === req.params.id);
  if (!q) return res.status(404).json({ error: 'Quiniela no encontrada' });
  const hasResults = q.results.every(r => r !== null);
  if (!hasResults) return res.json({ resultsCaptured: false, ranking: [] });

  const entries = db.quinielaEntries.filter(e => e.quinielaId === q.id);
  const ranking = entries
    .map(e => ({ username: e.username, code: e.code, hits: countHits(e.picks, q.results) }))
    .sort((a, b) => b.hits - a.hits);
  const maxHits = ranking.length ? ranking[0].hits : 0;
  ranking.forEach(r => { r.isWinner = r.hits === maxHits && maxHits > 0; });

  res.json({ resultsCaptured: true, ranking });
});

// Descargar el ranking en Excel
router.get('/quinielas/:id/ranking/export', (req, res) => {
  const db = readDb();
  const q = db.quinielas.find(q => q.id === req.params.id);
  if (!q) return res.status(404).json({ error: 'Quiniela no encontrada' });
  const hasResults = q.results.every(r => r !== null);
  const entries = db.quinielaEntries.filter(e => e.quinielaId === q.id);
  const rows = entries
    .map(e => ({
      Usuario: e.username,
      Código: e.code,
      Aciertos: hasResults ? countHits(e.picks, q.results) : '',
    }))
    .sort((a, b) => (b.Aciertos || 0) - (a.Aciertos || 0));
  const sheet = XLSX.utils.json_to_sheet(rows);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Ranking');
  const buffer = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="ranking-${q.name.replace(/[^a-z0-9]/gi, '-')}.xlsx"`);
  res.send(buffer);
});

module.exports = router;
