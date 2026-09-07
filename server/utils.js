const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const JWT_SECRET = process.env.JWT_SECRET || 'cambia-este-secreto-en-produccion';

function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No autenticado' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Token invalido o expirado, vuelve a iniciar sesión' });
  }
}

function adminOnly(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Solo un administrador puede hacer esto' });
  next();
}

function userOnly(req, res, next) {
  if (req.user?.role !== 'user') return res.status(403).json({ error: 'El administrador no apuesta, solo administra la cuenta' });
  next();
}

function newId(prefix) {
  return prefix + '_' + crypto.randomUUID();
}

module.exports = { signToken, authMiddleware, adminOnly, userOnly, newId };
