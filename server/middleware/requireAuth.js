function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({
      success: false,
      message: 'Inte inloggad'
    });
  }
  next();
}

module.exports = requireAuth;
