'use strict';
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.get('/api/health', (req, res) => res.json({ 
  status: 'ok', 
  service: 'monocomplex.ai API',
  timestamp: new Date()
}));

app.get('/', (req, res) => res.json({ 
  message: '🎬 monocomplex.ai API is running!',
  version: '1.0.3'
}));

try {
  const { connectDB } = require('./lib');
  connectDB();
  app.use('/api', require('./api/routes'));
} catch(err) {
  console.error('Startup error:', err.message);
}

app.use((err, req, res, next) => {
  res.status(500).json({ success: false, message: err.message });
});

module.exports = app;
