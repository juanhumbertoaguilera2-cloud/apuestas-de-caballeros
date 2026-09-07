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

// Todas las apuestas registradas en el sistema, para supervisión del admin
router.get('/offers', (req, res) => {
  const db = readDb();
  res.json(db.offers);
});

module.exports = router;
