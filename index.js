require('dotenv').config();
const express = require('express');
const app = express();

app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', '*');
  next();
});

// Health check - super simple, no DB needed
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'monocomplex.ai API', 
    timestamp: new Date(),
    version: '1.0.1'
  });
});

app.get('/', (req, res) => {
  res.json({ message: '🎬 monocomplex.ai API is running!' });
});

// Load routes safely
try {
  const routes = require('./api/routes');
  app.use('/api', routes);
} catch(err) {
  console.error('Routes load error:', err.message);
  app.use('/api', (req, res) => {
    res.status(500).json({ error: 'Routes failed to load', details: err.message });
  });
}

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ success: false, message: err.message });
});

module.exports = app;
