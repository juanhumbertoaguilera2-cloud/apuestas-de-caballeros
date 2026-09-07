const express = require('express');
const { readDb, writeDb, nextTicket } = require('../db');
const { authMiddleware, userOnly } = require('../utils');

const router = express.Router();
router.use(authMiddleware);

// Sugerencias de autocompletar: descripciones y lados usados por cualquier usuario
router.get('/suggestions', userOnly, (req, res) => {
  const db = readDb();
  res.json({
    descriptions: [...new Set(db.offers.map(o => o.description))],
    sides: [...new Set(db.offers.map(o => o.side))]
  });
});

// Registrar una apuesta ("registrar apuesta")
router.post('/', userOnly, (req, res) => {
  const { category, description, side, amount, maxCopies, payoutMultiplier } = req.body || {};
  if (!description || !description.trim()) return res.status(400).json({ error: 'Describe el partido o situación' });
  if (!side || !side.trim()) return res.status(400).json({ error: 'Indica a qué le apuestas' });
  const numAmount = Number(amount);
  const numCopies = Number(maxCopies) || 1;
  const multiplier = [1, 2, 3].includes(Number(payoutMultiplier)) ? Number(payoutMultiplier) : 1;
  if (!(numAmount > 0)) return res.status(400).json({ error: 'El monto debe ser mayor a 0' });
  if (!(numCopies >= 1)) return res.status(400).json({ error: 'Debes permitir al menos 1 toma' });

  const db = readDb();
  const offer = {
    ticket: nextTicket(db, 'REG'),
    creatorId: req.user.id,
    creatorUsername: req.user.username,
    category: (category || 'General').trim(),
    description: description.trim(),
    side: side.trim(),
    amount: numAmount,
    maxCopies: numCopies,
    copiesTaken: 0,
    payoutMultiplier: multiplier,
    status: 'open',
    createdAt: new Date().toISOString()
  };
  db.offers.push(offer);
  writeDb(db);
  res.status(201).json(offer);
});

// Mercado: apuestas abiertas de otros usuarios
router.get('/', userOnly, (req, res) => {
  const db = readDb();
  const open = db.offers.filter(o =>
    o.status === 'open' && o.copiesTaken < o.maxCopies && o.creatorId !== req.user.id
  );
  res.json(open);
});

// Tomar una apuesta ("tomar apuesta")
router.post('/:ticket/take', userOnly, (req, res) => {
  const { ticket } = req.params;
  const { takerSide } = req.body || {};
  const db = readDb();
  const offer = db.offers.find(o => o.ticket === ticket);
  if (!offer) return res.status(404).json({ error: 'Apuesta no encontrada' });
  if (offer.creatorId === req.user.id) return res.status(400).json({ error: 'No puedes tomar tu propia apuesta' });
  if (offer.status !== 'open' || offer.copiesTaken >= offer.maxCopies) {
    return res.status(409).json({ error: 'Esa apuesta ya no está disponible (alguien más pudo haberla tomado).' });
  }

  const contract = {
    ticket: nextTicket(db, 'TCK'),
    offerTicket: offer.ticket,
    creatorId: offer.creatorId,
    creatorUsername: offer.creatorUsername,
    takerId: req.user.id,
    takerUsername: req.user.username,
    amount: offer.amount,
    creatorSide: offer.side,
    takerSide: (takerSide && takerSide.trim()) || ('Contrario a: ' + offer.side),
    description: offer.description,
    category: offer.category,
    payoutMultiplier: offer.payoutMultiplier,
    createdAt: new Date().toISOString()
  };
  db.contracts.push(contract);
  offer.copiesTaken += 1;
  if (offer.copiesTaken >= offer.maxCopies) offer.status = 'full';
  writeDb(db);
  res.status(201).json(contract);
});

// Mis apuestas: registradas y tomadas
router.get('/mine/all', userOnly, (req, res) => {
  const db = readDb();
  const myOffers = db.offers.filter(o => o.creatorId === req.user.id);
  const myContracts = db.contracts
    .filter(c => c.creatorId === req.user.id || c.takerId === req.user.id)
    .map(c => ({
      ...c,
      role: c.creatorId === req.user.id ? 'creator' : 'taker',
      counterpartUsername: c.creatorId === req.user.id ? c.takerUsername : c.creatorUsername
    }));
  res.json({ offers: myOffers, contracts: myContracts });
});

module.exports = router;
