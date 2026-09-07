const express = require('express');
const bcrypt = require('bcryptjs');
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

// Todas las apuestas ya tomadas (contratos), con quién apostó y quién tomó,
// para que el admin sepa a quién cobrarle o pagarle.
router.get('/contracts', (req, res) => {
  const db = readDb();
  res.json(db.contracts);
});

module.exports = router;
