const express = require('express');
const app = express();
const router = express.Router();

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

router.get('/items/:id', (req, res) => {
  res.json({ id: req.params.id });
});

router.post('/items', (req, res) => {
  res.status(201).json(req.body);
});

app.use('/api', router);

module.exports = app;
