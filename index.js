'use strict';
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors({ origin: '*', credentials: true, methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'], allowedHeaders: ['Content-Type','Authorization','x-admin-secret'] }));
app.options('*', cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.get('/', (req, res) => {
  res.json({ message: '🎬 monocomplex.ai is running!', version: '1.0.5' });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'monocomplex.ai API', timestamp: new Date() });
});

app.use('/api', require('./api/routes'));

app.use((err, req, res, next) => {
  res.status(500).json({ success: false, message: err.message });
});

module.exports = app;
