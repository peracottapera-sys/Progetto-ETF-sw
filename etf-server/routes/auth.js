const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const authMiddleware = require('../middleware/auth');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_only_secret_change_in_production';

module.exports = (db) => {
  const router = express.Router();

  // POST /api/auth/login
  router.post('/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ error: 'Username e password richiesti' });
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user || !bcrypt.compareSync(password, user.password))
      return res.status(401).json({ error: 'Username o password errati' });
    const token = jwt.sign(
      { id: user.id, username: user.username, email: user.email },
      JWT_SECRET, { expiresIn: '24h' }
    );
    console.log(`[${new Date().toLocaleTimeString()}] Login: ${username}`);
    res.json({ token, user: { id: user.id, username: user.username, email: user.email } });
  });

  // POST /api/auth/register
  router.post('/register', (req, res) => {
    const { username, password, email } = req.body;
    if (!username || !password)
      return res.status(400).json({ error: 'Username e password richiesti' });
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) return res.status(409).json({ error: 'Username già esistente' });
    const hash = bcrypt.hashSync(password, 10);
    const id = 'u' + Date.now();
    db.prepare('INSERT INTO users (id, username, password, email) VALUES (?, ?, ?, ?)').run(id, username, hash, email || null);
    const token = jwt.sign({ id, username, email }, JWT_SECRET, { expiresIn: '24h' });
    console.log(`[${new Date().toLocaleTimeString()}] Registrazione: ${username}`);
    res.json({ token, user: { id, username, email } });
  });

  // PUT /api/auth/user
  router.put('/user', authMiddleware, (req, res) => {
    const { email, password } = req.body;
    if (email) db.prepare('UPDATE users SET email = ? WHERE id = ?').run(email, req.user.id);
    if (password) db.prepare('UPDATE users SET password = ? WHERE id = ?').run(bcrypt.hashSync(password, 10), req.user.id);
    res.json({ ok: true });
  });

  // GET /api/auth/me
  router.get('/me', authMiddleware, (req, res) => {
    const user = db.prepare('SELECT id, username, email FROM users WHERE id = ?').get(req.user.id);
    res.json({ user });
  });

  return router;
};
