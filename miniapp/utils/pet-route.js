function routePetId(value) {
  if (typeof value !== 'string' || !value) return '';
  try { value = decodeURIComponent(value); } catch (_) { return ''; }
  return value.trim() === value && value.length <= 191 ? value : '';
}

module.exports = { routePetId };
