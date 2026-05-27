const crypto = require('crypto');

const ALGO      = 'aes-256-cbc';
const KEY_RAW   = process.env.BACKUP_ENCRYPTION_KEY || 'hostel_backup_key_change_in_prod!!';
// Derive exactly 32 bytes from the env key
const KEY       = crypto.scryptSync(KEY_RAW, 'hostel_salt', 32);

function encrypt(plaintext) {
  const iv         = crypto.randomBytes(16);
  const cipher     = crypto.createCipheriv(ALGO, KEY, iv);
  const encrypted  = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decrypt(ciphertext) {
  const [ivHex, encHex] = ciphertext.split(':');
  const iv        = Buffer.from(ivHex, 'hex');
  const enc       = Buffer.from(encHex, 'hex');
  const decipher  = crypto.createDecipheriv(ALGO, KEY, iv);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt };