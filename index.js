'use strict';
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors({
  origin: ['https://khan-mono.github.io','https://monocomplex.ai','http://localhost:3000','http://127.0.0.1:5500'],
  credentials: true,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization','x-admin-secret'],
}));
app.options('*', cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'monocomplex.ai API', version: '1.0.4' }));
app.get('/', (req, res) => res.json({ message: '🎬 monocomplex.ai API is running!', version: '1.0.4' }));

try { const { connectDB } = require('./lib'); connectDB(); } catch(err) { console.error('DB:', err.message); }
try { app.use('/api', require('./api/routes')); } catch(err) { console.error('Routes:', err.message); }

app.use((err, req, res, next) => res.status(500).json({ success: false, message: err.message }));
module.exports = app;
