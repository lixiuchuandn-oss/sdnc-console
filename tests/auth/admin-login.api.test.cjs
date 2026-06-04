const { towerLogin, towerApi } = require('../shared/tower-api.cjs');
(async () => {
  const results = [];
  const token = await towerLogin();
  results.push({ case: 'login', ok: !!token });
  const home = await towerApi('GET', '/api/auth/admin-default-home', null, token);
  results.push({ case: 'admin-default-home', ok: home.status === 200, status: home.status });
  const bad = await towerApi('POST', '/api/auth/login', { username: 'admin', password: 'bad' }, null);
  results.push({ case: 'wrong-password', ok: bad.status === 401 });
  const passed = results.filter((r) => r.ok).length;
  console.log(JSON.stringify({ summary: `${passed}/${results.length}`, results }, null, 2));
  process.exit(passed === results.length ? 0 : 1);
})().catch((e) => { console.error(e.message); process.exit(2); });