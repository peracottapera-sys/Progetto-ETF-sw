const jwt = require('jsonwebtoken');

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer '))
    return res.status(401).json({ error: 'Token mancante' });
  try {
    req.user = jwt.verify(auth.slice(7), process.env.JWT_SECRET || 'dev_only_secret_change_in_production');
    next();
  } catch {
    res.status(401).json({ error: 'Token non valido o scaduto' });
  }
}

module.exports = authMiddleware;
