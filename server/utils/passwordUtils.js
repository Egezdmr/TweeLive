const bcrypt = require('bcrypt');

const SALT_ROUNDS = 10;

// Hashar lösenordet vid registrering
async function hashPassword(password) {
  try {
    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    return hash;
  } catch (error) {
    throw new Error('Kunde inte kryptera lösenordet: ' + error.message);
  }
}

// Jämför lösenord vid inloggning
async function comparePassword(plainPassword, hashedPassword) {
  try {
    const isMatch = await bcrypt.compare(plainPassword, hashedPassword);
    return isMatch;
  } catch (error) {
    throw new Error('Kunde inte jämföra lösenordet: ' + error.message);
  }
}

module.exports = { hashPassword, comparePassword };
