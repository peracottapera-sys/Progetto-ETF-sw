const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const authMiddleware = require('../middleware/auth');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_only_secret_change_in_production';

module.exports = (pool) => {
  const router = express.Router();

  router.post('/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username e password richiesti' });
    const { rows } = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    const user = rows[0];
    if (!user || !bcrypt.compareSync(password, user.password))
      return res.status(401).json({ error: 'Username o password errati' });
    const token = jwt.sign({ id: user.id, username: user.username, email: user.email }, JWT_SECRET, { expiresIn: '24h' });
    console.log(`[${new Date().toLocaleTimeString()}] Login: ${username}`);
    res.json({ token, user: { id: user.id, username: user.username, email: user.email } });
  });

  router.post('/register', async (req, res) => {
    const { username, password, email } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username e password richiesti' });
    const { rows: ex } = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
    if (ex.length > 0) return res.status(409).json({ error: 'Username già esistente' });
    const hash = bcrypt.hashSync(password, 10);
    const id = 'u' + Date.now();
    await pool.query('INSERT INTO users (id, username, password, email) VALUES ($1, $2, $3, $4)', [id, username, hash, email || null]);
    const token = jwt.sign({ id, username, email }, JWT_SECRET, { expiresIn: '24h' });
    console.log(`[${new Date().toLocaleTimeString()}] Registrazione: ${username}`);
    res.json({ token, user: { id, username, email } });
  });

  router.put('/user', authMiddleware, async (req, res) => {
    const { email, password } = req.body;
    if (email)    await pool.query('UPDATE users SET email = $1 WHERE id = $2', [email, req.user.id]);
    if (password) await pool.query('UPDATE users SET password = $1 WHERE id = $2', [bcrypt.hashSync(password, 10), req.user.id]);
    res.json({ ok: true });
  });

  router.get('/me', authMiddleware, async (req, res) => {
    const { rows } = await pool.query('SELECT id, username, email FROM users WHERE id = $1', [req.user.id]);
    res.json({ user: rows[0] });
  });

  return router;
};
