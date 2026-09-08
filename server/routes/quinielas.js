const express = require('express');
const { readDb, writeDb, nextTicket } = require('../db');
const { authMiddleware, userOnly, newId } = require('../utils');
const { buildQuinielaPdfBuffer } = require('../pdf');

const router = express.Router();
router.use(authMiddleware, userOnly);

// Lista de quinielas disponibles, indicando si el usuario ya la llenó
router.get('/', (req, res) => {
  const db = readDb();
  const list = db.quinielas.map(q => {
    const myEntry = db.quinielaEntries.find(e => e.quinielaId === q.id && e.userId === req.user.id);
    return {
      id: q.id,
      name: q.name,
      matchCount: q.matches.length,
      resultsCaptured: q.results.every(r => r !== null),
      myEntryCode: myEntry ? myEntry.code : null
    };
  });
  res.json(list);
});

// Detalle de una quiniela para llenarla (o ver que ya se llenó)
router.get('/:id', (req, res) => {
  const db = readDb();
  const q = db.quinielas.find(q => q.id === req.params.id);
  if (!q) return res.status(404).json({ error: 'Quiniela no encontrada' });
  const myEntry = db.quinielaEntries.find(e => e.quinielaId === q.id && e.userId === req.user.id);
  res.json({
    id: q.id,
    name: q.name,
    matches: q.matches,
    myEntry: myEntry ? { id: myEntry.id, code: myEntry.code, picks: myEntry.picks, createdAt: myEntry.createdAt } : null
  });
});

// Llenar una quiniela (una sola vez por usuario)
router.post('/:id/entries', (req, res) => {
  const { picks } = req.body || {};
  const db = readDb();
  const q = db.quinielas.find(q => q.id === req.params.id);
  if (!q) return res.status(404).json({ error: 'Quiniela no encontrada' });

  const already = db.quinielaEntries.find(e => e.quinielaId === q.id && e.userId === req.user.id);
  if (already) return res.status(409).json({ error: 'Ya llenaste esta quiniela', code: already.code });

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
    createdAt: new Date().toISOString()
  };
  db.quinielaEntries.push(entry);
  writeDb(db);
  res.status(201).json(entry);
});

// Descargar el PDF de mi propio comprobante
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
