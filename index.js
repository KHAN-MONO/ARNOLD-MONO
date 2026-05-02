'use strict';
const express = require('express');
const app = express();
app.use(express.json());
app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'monocomplex.ai' }));
app.get('/', (req, res) => res.json({ status: 'ok' }));
module.exports = app;

