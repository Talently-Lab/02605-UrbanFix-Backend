function parseFrontendOrigins(value) {
  const invalidConfiguration = () => new Error(
    'FRONTEND_URL es obligatoria y debe contener orígenes HTTP/HTTPS válidos separados por comas, sin credenciales, paths, query, fragmentos ni comodines.',
  );
  if (typeof value !== 'string' || !value.trim()) throw invalidConfiguration();
  const origins = value.split(',').map(entry => {
    const origin = entry.trim();
    if (!/^https?:\/\/[^/?#\\\s]+\/?$/i.test(origin) || origin.includes('*') || origin.includes('@')) {
      throw invalidConfiguration();
    }
    let url;
    try {
      url = new URL(origin);
    } catch {
      throw invalidConfiguration();
    }
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      throw invalidConfiguration();
    }
    return url.origin;
  });
  return [...new Set(origins)];
}

module.exports = { parseFrontendOrigins };
