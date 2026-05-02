'use strict';
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors({ origin: '*' }));
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'monocomplex.ai API', timestamp: new Date() });
});

app.get('/', (req, res) => {
  res.json({ message: '🎬 monocomplex.ai is running!' });
});

app.use('/api', require('./api/routes'));

app.use((err, req, res, next) => {
  res.status(500).json({ success: false, message: err.message });
});

module.exports = app;
