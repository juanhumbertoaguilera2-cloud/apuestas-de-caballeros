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
  if (!(numAmount >= 20)) return res.status(400).json({ error: 'La apuesta mínima es de $20 pesos' });
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

// Mis apuestas: registradas y tomadas. Las que el jugador ya "borró" de su
// pantalla no se muestran (siguen existiendo para el admin y la contraparte).
const isHiddenFor = (item, userId) => (item.hiddenBy || []).includes(userId);

router.get('/mine/all', userOnly, (req, res) => {
  const db = readDb();
  const myOffers = db.offers.filter(o => o.creatorId === req.user.id && !isHiddenFor(o, req.user.id));
  const myContracts = db.contracts
    .filter(c => (c.creatorId === req.user.id || c.takerId === req.user.id) && !isHiddenFor(c, req.user.id))
    .map(c => ({
      ...c,
      role: c.creatorId === req.user.id ? 'creator' : 'taker',
      counterpartUsername: c.creatorId === req.user.id ? c.takerUsername : c.creatorUsername
    }));
  res.json({ offers: myOffers, contracts: myContracts });
});

// Borrar una apuesta registrada por mí:
//  - Si nadie la ha tomado: se elimina por completo (sale del Mercado).
//  - Si ya se llenó el cupo (todas las tomas hechas): solo se quita de MI
//    pantalla; el admin y quienes la tomaron conservan su registro.
//  - Si sigue abierta con tomas parciales: no se puede, porque aún está
//    activa en el Mercado.
router.delete('/:ticket', userOnly, (req, res) => {
  const db = readDb();
  const offer = db.offers.find(o => o.ticket === req.params.ticket);
  if (!offer) return res.status(404).json({ error: 'Apuesta no encontrada' });
  if (offer.creatorId !== req.user.id) return res.status(403).json({ error: 'No puedes borrar una apuesta que no es tuya' });

  if (offer.copiesTaken === 0) {
    db.offers = db.offers.filter(o => o.ticket !== req.params.ticket);
    writeDb(db);
    return res.json({ ok: true, mode: 'deleted' });
  }
  if (offer.status === 'full') {
    offer.hiddenBy = [...new Set([...(offer.hiddenBy || []), req.user.id])];
    writeDb(db);
    return res.json({ ok: true, mode: 'hidden' });
  }
  return res.status(409).json({ error: 'Esta apuesta sigue abierta en el Mercado y ya tiene tomas. Podrás borrarla cuando se llene el cupo.' });
});

// Borrar de MI pantalla una apuesta que hice o tomé (contrato). El admin y la
// contraparte conservan el registro para el cobro.
router.delete('/contracts/:ticket', userOnly, (req, res) => {
  const db = readDb();
  const contract = db.contracts.find(c => c.ticket === req.params.ticket);
  if (!contract) return res.status(404).json({ error: 'Apuesta no encontrada' });
  if (contract.creatorId !== req.user.id && contract.takerId !== req.user.id) {
    return res.status(403).json({ error: 'Esa apuesta no es tuya' });
  }
  contract.hiddenBy = [...new Set([...(contract.hiddenBy || []), req.user.id])];
  writeDb(db);
  res.json({ ok: true });
});

module.exports = router;
