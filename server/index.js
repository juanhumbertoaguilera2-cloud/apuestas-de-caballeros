const express = require('express');
const cors = require('cors');
const path = require('path');

const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const betsRoutes = require('./routes/bets');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/bets', betsRoutes);

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`Apuestas de Caballeros corriendo en el puerto ${PORT}`);
});
