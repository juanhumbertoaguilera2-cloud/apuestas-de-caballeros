const express = require('express');
const bcrypt = require('bcryptjs');
const { readDb, writeDb } = require('../db');
const { signToken, authMiddleware } = require('../utils');

const router = express.Router();

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Usuario y contraseña son requeridos' });
  const db = readDb();
  const user = db.users.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  }
  const token = signToken(user);
  res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
});

router.get('/me', authMiddleware, (req, res) => {
  const db = readDb();
  const user = db.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  res.json({ id: user.id, username: user.username, role: user.role });
});

// Cualquier usuario autenticado puede cambiar sus propias credenciales,
// confirmando su contraseña actual.
router.patch('/me', authMiddleware, (req, res) => {
  const { newUsername, newPassword, currentPassword } = req.body || {};
  const db = readDb();
  const user = db.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (!currentPassword || !bcrypt.compareSync(currentPassword, user.passwordHash)) {
    return res.status(401).json({ error: 'Tu contraseña actual no es correcta' });
  }
  if (newUsername && newUsername.trim() && newUsername.trim().toLowerCase() !== user.username.toLowerCase()) {
    const taken = db.users.some(u => u.id !== user.id && u.username.toLowerCase() === newUsername.trim().toLowerCase());
    if (taken) return res.status(409).json({ error: 'Ese nombre de usuario ya lo tiene alguien más' });
    user.username = newUsername.trim();
  }
  if (newPassword) {
    if (newPassword.length < 4) return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 4 caracteres' });
    user.passwordHash = bcrypt.hashSync(newPassword, 10);
  }
  writeDb(db);
  const token = signToken(user);
  res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
});

module.exports = router;
