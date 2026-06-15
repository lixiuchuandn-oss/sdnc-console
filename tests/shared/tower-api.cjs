const { apiBase, adminUser, adminPassword } = require('./load-env.cjs');

async function towerLogin() {
  const res = await fetch(`${apiBase}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: adminUser, password: adminPassword }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.token) throw new Error(data.message || `login HTTP ${res.status}`);
  return data.token;
}

async function towerApi(method, path, body, token) {
  const res = await fetch(`${apiBase}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function listCloudPools(token) {
  const { status, data } = await towerApi('GET', '/api/clouds', null, token);
  if (status !== 200 || !Array.isArray(data)) throw new Error('list clouds failed');
  return data;
}

async function resolveCloudId(token, preferredId) {
  if (preferredId) return preferredId;
  const pools = await listCloudPools(token);
  const hit = pools.find((p) => String(p.status || '').toLowerCase() === 'online');
  if (!hit?.id) throw new Error('no online pool; set TOWER_CLOUD_ID');
  return hit.id;
}

module.exports = { towerLogin, towerApi, listCloudPools, resolveCloudId };