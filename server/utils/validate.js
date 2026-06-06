const required = (val, field) =>
  (!val && val !== 0) ? `${field} is required` : null;

const mobile = (val, field = 'Mobile number') => {
  if (!val) return null;
  const clean = String(val).replace(/\s|-/g, '');
  if (!/^\d{10}$/.test(clean)) return `${field} must be exactly 10 digits`;
  return null;
};

const aadhar = (val, field = 'Aadhar number') => {
  if (!val) return null;
  const clean = String(val).replace(/\s/g, '');
  if (!/^\d{12}$/.test(clean)) return `${field} must be exactly 12 digits`;
  return null;
};

const number = (val, field) =>
  (val !== undefined && val !== '' && isNaN(Number(val))) ? `${field} must be a number` : null;

const positive = (val, field) =>
  (val !== undefined && val !== '' && !isNaN(Number(val)) && Number(val) < 0) ? `${field} cannot be negative` : null;

const minLength = (val, field, min) =>
  (val && String(val).length < min) ? `${field} must be at least ${min} characters` : null;

const collect = (rules) => rules.filter(Boolean);

module.exports = { required, mobile, aadhar, number, positive, minLength, collect };