const express = require('express');
const { readDb, writeDb, nextTicket } = require('../db');
const { authMiddleware, userOnly, newId } = require('../utils');
const { buildQuinielaPdfBuffer } = require('../pdf');

const router = express.Router();
router.use(authMiddleware, userOnly);

// Lista de quinielas disponibles, indicando cuántas veces ya la llenó el usuario
router.get('/', (req, res) => {
  const db = readDb();
  const list = db.quinielas.map(q => {
    const myEntries = db.quinielaEntries.filter(e => e.quinielaId === q.id && e.userId === req.user.id);
    return {
      id: q.id,
      name: q.name,
      cost: q.cost || 0,
      matchCount: q.matches.length,
      resultsCaptured: q.results.every(r => r !== null),
      myEntryCount: myEntries.length
    };
  });
  res.json(list);
});

// Todas mis quinielas llenadas (de todas las quinielas), para poder verlas y
// descargar el PDF de cada una cuando quiera, en cualquier momento.
router.get('/entries/mine', (req, res) => {
  const db = readDb();
  const mine = db.quinielaEntries
    .filter(e => e.userId === req.user.id)
    .map(e => ({
      id: e.id,
      quinielaId: e.quinielaId,
      quinielaName: e.quinielaName,
      code: e.code,
      createdAt: e.createdAt
    }))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(mine);
});

// Detalle de una quiniela para llenarla, incluyendo mis entradas previas ahí
router.get('/:id', (req, res) => {
  const db = readDb();
  const q = db.quinielas.find(q => q.id === req.params.id);
  if (!q) return res.status(404).json({ error: 'Quiniela no encontrada' });
  const myEntries = db.quinielaEntries
    .filter(e => e.quinielaId === q.id && e.userId === req.user.id)
    .map(e => ({ id: e.id, code: e.code, picks: e.picks, createdAt: e.createdAt }));
  res.json({
    id: q.id,
    name: q.name,
    cost: q.cost || 0,
    matches: q.matches,
    myEntries
  });
});

// Llenar una quiniela. Un usuario puede llenar la misma quiniela las veces
// que quiera (por ejemplo, para participar con más de un boleto).
router.post('/:id/entries', (req, res) => {
  const { picks } = req.body || {};
  const db = readDb();
  const q = db.quinielas.find(q => q.id === req.params.id);
  if (!q) return res.status(404).json({ error: 'Quiniela no encontrada' });

  if (!Array.isArray(picks) || picks.length !== q.matches.length) {
    return res.status(400).json({ error: `Debes seleccionar los ${q.matches.length} partidos` });
  }
  if (!picks.every(p => ['L', 'E', 'V'].includes(p))) {
    return res.status(400).json({ error: 'Cada selección debe ser L, E o V' });
  }

  const entry = {
    id: newId('qne'),
    quinielaId: q.id,
    quinielaName: q.name,
    userId: req.user.id,
    username: req.user.username,
    code: nextTicket(db, 'QN'),
    picks,
    paid: false,
    createdAt: new Date().toISOString()
  };
  db.quinielaEntries.push(entry);
  writeDb(db);
  res.status(201).json(entry);
});

// Descargar el PDF de cualquiera de mis comprobantes, cuando quiera
router.get('/entries/:entryId/pdf', async (req, res) => {
  const db = readDb();
  const entry = db.quinielaEntries.find(e => e.id === req.params.entryId);
  if (!entry) return res.status(404).json({ error: 'Comprobante no encontrado' });
  if (entry.userId !== req.user.id) return res.status(403).json({ error: 'Ese comprobante no es tuyo' });
  const q = db.quinielas.find(q => q.id === entry.quinielaId);
  if (!q) return res.status(404).json({ error: 'La quiniela ya no existe' });

  try {
    const buffer = await buildQuinielaPdfBuffer(entry, q);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="quiniela-${entry.code}.pdf"`);
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: 'No se pudo generar el PDF' });
  }
});

module.exports = router;
