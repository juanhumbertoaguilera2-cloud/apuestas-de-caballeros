const express = require('express');
const { readDb, writeDb, nextTicket } = require('../db');
const { authMiddleware, userOnly, newId } = require('../utils');
const { buildQuinielaPdfBuffer } = require('../pdf');

const router = express.Router();
router.use(authMiddleware, userOnly);

function countHits(picks, results) {
  return picks.reduce((sum, p, i) => sum + (results[i] && p === results[i] ? 1 : 0), 0);
}

function canFill(q) {
  // Se cierra en cuanto el admin captura el PRIMER resultado (no hasta que
  // estén todos) — evita que alguien llene con información de partidos que
  // ya se jugaron.
  return q.active !== false && !q.results.some(r => r !== null);
}

// Ranking de una quiniela según los resultados capturados hasta ahora (en
// vivo) o finales. Los empates comparten posición (1, 1, 3...). Solo se
// muestran usuario, código y aciertos — nunca las selecciones de otros.
function rankingFor(db, q, userId, limit) {
  const started = q.results.some(r => r !== null);
  const complete = q.results.every(r => r !== null);
  const all = db.quinielaEntries.filter(e => e.quinielaId === q.id);
  if (!started) {
    return { resultsStarted: false, resultsComplete: false, totalEntries: all.length, top: [], mine: [] };
  }
  const entries = all
    .map(e => ({ userId: e.userId, username: e.username, code: e.code, hits: countHits(e.picks, q.results) }))
    .sort((a, b) => b.hits - a.hits);
  const maxHits = entries.length ? entries[0].hits : 0;
  let position = 0;
  let prevHits = null;
  entries.forEach((e, i) => {
    if (e.hits !== prevHits) { position = i + 1; prevHits = e.hits; }
    e.position = position;
    e.isWinner = complete && e.hits === maxHits && maxHits > 0;
    e.isMine = e.userId === userId;
  });
  const clean = ({ position, username, code, hits, isWinner, isMine }) => ({ position, username, code, hits, isWinner, isMine });
  return {
    resultsStarted: true,
    resultsComplete: complete,
    totalEntries: entries.length,
    top: entries.slice(0, limit).map(clean),
    mine: entries.filter(e => e.isMine).map(clean)
  };
}

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
      canFill: canFill(q),
      resultsStarted: q.results.some(r => r !== null),
      resultsComplete: q.results.every(r => r !== null),
      myEntryCount: myEntries.length,
      ranking: rankingFor(db, q, req.user.id, 3)
    };
  });
  res.json(list);
});

// Todas mis quinielas llenadas (de todas las quinielas), con mis aciertos en
// vivo (según lo que el admin ya haya capturado) y para descargar el PDF
// de cada una cuando quiera, en cualquier momento.
router.get('/entries/mine', (req, res) => {
  const db = readDb();
  const mine = db.quinielaEntries
    .filter(e => e.userId === req.user.id)
    .map(e => {
      const q = db.quinielas.find(q => q.id === e.quinielaId);
      const started = q && q.results.some(r => r !== null);
      return {
        id: e.id,
        quinielaId: e.quinielaId,
        quinielaName: e.quinielaName,
        code: e.code,
        createdAt: e.createdAt,
        hits: started ? countHits(e.picks, q.results) : null,
        resultsComplete: q ? q.results.every(r => r !== null) : false
      };
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(mine);
});

// Detalle de una quiniela para llenarla, incluyendo mis entradas previas ahí
// y los resultados capturados hasta ahora (aunque sea parcial) para comparar.
router.get('/:id', (req, res) => {
  const db = readDb();
  const q = db.quinielas.find(q => q.id === req.params.id);
  if (!q) return res.status(404).json({ error: 'Quiniela no encontrada' });
  const started = q.results.some(r => r !== null);
  const myEntries = db.quinielaEntries
    .filter(e => e.quinielaId === q.id && e.userId === req.user.id)
    .map(e => ({
      id: e.id,
      code: e.code,
      picks: e.picks,
      createdAt: e.createdAt,
      hits: started ? countHits(e.picks, q.results) : null
    }));
  res.json({
    id: q.id,
    name: q.name,
    cost: q.cost || 0,
    matches: q.matches,
    canFill: canFill(q),
    results: started ? q.results : null,
    resultsComplete: q.results.every(r => r !== null),
    ranking: rankingFor(db, q, req.user.id, 20),
    myEntries
  });
});

// Llenar una quiniela. Un usuario puede llenar la misma quiniela las veces
// que quiera, mientras siga activa y no haya terminado.
router.post('/:id/entries', (req, res) => {
  const { picks } = req.body || {};
  const db = readDb();
  const q = db.quinielas.find(q => q.id === req.params.id);
  if (!q) return res.status(404).json({ error: 'Quiniela no encontrada' });
  if (!canFill(q)) {
    return res.status(409).json({ error: 'Esta quiniela ya no está disponible para llenarse' });
  }

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
