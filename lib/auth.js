// Simpele HTTP Basic Auth: de browser toont een eigen inlogpopup vóórdat er iets geladen wordt.
// Gebruikersnaam/wachtwoord staan alleen in de omgevingsvariabelen (.env lokaal, of ingesteld
// bij de hostingpartij), nooit in de code zelf.
function basicAuth(req, res, next) {
  const gebruikersnaam = process.env.FACTUUR_APP_GEBRUIKERSNAAM;
  const wachtwoord = process.env.FACTUUR_APP_WACHTWOORD;

  if (!gebruikersnaam || !wachtwoord) {
    console.warn('Let op: FACTUUR_APP_GEBRUIKERSNAAM/WACHTWOORD zijn niet ingesteld — de app is nu NIET beveiligd.');
    return next();
  }

  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');

  if (scheme === 'Basic' && encoded) {
    const [user, pass] = Buffer.from(encoded, 'base64').toString('utf8').split(':');
    if (user === gebruikersnaam && pass === wachtwoord) {
      return next();
    }
  }

  res.set('WWW-Authenticate', 'Basic realm="Studio Levant Facturen"');
  res.status(401).send('Inloggen vereist.');
}

module.exports = basicAuth;
