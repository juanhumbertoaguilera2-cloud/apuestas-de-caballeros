const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');

function defaultDb() {
  return {
    users: [{
      id: 'u_admin',
      username: 'admin',
      passwordHash: bcrypt.hashSync('admin123', 10),
      role: 'admin',
      createdAt: new Date().toISOString()
    }],
    offers: [],
    contracts: [],
    quinielas: [],
    quinielaEntries: [],
    ticketSeq: 1
  };
}

function ensureDb() {
  if (!fs.existsSync(DB_PATH)) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    const seeded = defaultDb();
    fs.writeFileSync(DB_PATH, JSON.stringify(seeded, null, 2));
    console.log('>> Base de datos inicializada. Usuario admin por defecto -> usuario: admin / password: admin123');
    console.log('>> IMPORTANTE: cambia esta contraseña en cuanto entres (Administración > Mi cuenta).');
  }
}

function readDb() {
  ensureDb();
  const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
  // Migración suave: si la base de datos es de antes de que existieran las
  // quinielas, les agregamos los arreglos vacíos para no romper nada.
  if (!db.quinielas) db.quinielas = [];
  if (!db.quinielaEntries) db.quinielaEntries = [];
  return db;
}

function writeDb(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function nextTicket(db, prefix) {
  const code = prefix + '-' + String(db.ticketSeq).padStart(4, '0');
  db.ticketSeq++;
  return code;
}

module.exports = { readDb, writeDb, nextTicket, DB_PATH };
