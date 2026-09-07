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

module.exports = router;
