/**
 * CSM 资源池 · 租户 BFF E2E（API）
 *
 * 环境变量（tests/.env）：
 * - TOWER_CSM_CLOUD_ID          可选；默认按 TOWER_CSM_ENDPOINT_HINT 或首个 online CSM 池
 * - TOWER_CSM_ENDPOINT_HINT     可选；如 10.21.17.68
 * - TOWER_CSM_REPAIR_USERNAME   可选；写入 cloud.config 后测租户 200
 * - TOWER_CSM_REPAIR_PASSWORD_ENCRYPTED  可选；CSM Web 登录 RSA 密文
 * - TOWER_CSM_WEB_PORT          可选；默认从 endpoint 端口推导
 * - TOWER_CSM_TENANTS_REQUIRE_OK=1  强制要求租户接口 200（需已配 repair 凭据）
 */
const {
  csmCloudId,
  csmEndpointHint,
  csmRepairUsername,
  csmRepairPasswordEncrypted,
  csmWebPort,
  csmTenantsRequireOk,
} = require('../../shared/load-env.cjs');
const { towerLogin } = require('../../shared/tower-api.cjs');
const {
  resolveCsmCloudId,
  fetchCsmCloud,
  getCsmBff,
  patchCsmRepairAuth,
  hasCsmRepairAuthInConfig,
} = require('./lib/csm-api.cjs');

function assertOkCase(name, res, extra = {}) {
  if (res.status !== 200) {
    throw new Error(`${name} 期望 HTTP 200，实际 ${res.status}: ${JSON.stringify(res.data)}`);
  }
  return { case: name, ok: true, ...extra };
}

(async () => {
  const results = [];
  const token = await towerLogin();
  const cloudId = await resolveCsmCloudId(token, {
    cloudId: csmCloudId,
    endpointHint: csmEndpointHint,
  });
  let cloud = await fetchCsmCloud(token, cloudId);

  results.push({
    case: 'resolve-csm-cloud',
    ok: true,
    cloudId,
    endpoint: cloud.endpoint,
    hasRepairAuth: hasCsmRepairAuthInConfig(cloud),
  });

  const virtual = await getCsmBff(token, cloudId, 'security/virtual-elements');
  results.push(
    assertOkCase('virtual-elements-ak-sk', virtual, {
      itemCount: Array.isArray(virtual.data?.data?.items) ? virtual.data.data.items.length : null,
    }),
  );

  const groups = await getCsmBff(token, cloudId, 'security/element-groups');
  results.push(assertOkCase('element-groups-ak-sk', groups));

  let patchedRepairAuth = false;
  if (csmRepairPasswordEncrypted) {
    const patch = await patchCsmRepairAuth(token, cloudId, cloud, {
      username: csmRepairUsername || 'admin',
      passwordEncrypted: csmRepairPasswordEncrypted,
      webPort: csmWebPort || undefined,
    });
    if (patch.status !== 200) {
      throw new Error(`写入 CSM repair 凭据失败 HTTP ${patch.status}: ${JSON.stringify(patch.data)}`);
    }
    cloud = await fetchCsmCloud(token, cloudId);
    patchedRepairAuth = true;
    results.push({ case: 'patch-repair-auth', ok: true });
  }

  const tenants = await getCsmBff(token, cloudId, 'tenants');
  const requireOk =
    csmTenantsRequireOk ||
    patchedRepairAuth ||
    hasCsmRepairAuthInConfig(cloud);

  if (requireOk) {
    if (tenants.status !== 200) {
      throw new Error(
        `tenants 期望 HTTP 200，实际 ${tenants.status}: ${JSON.stringify(tenants.data)}`,
      );
    }
    if (!Array.isArray(tenants.data?.data?.items)) {
      throw new Error('tenants 响应缺少 data.items 数组');
    }
    results.push({
      case: 'tenants-v2',
      ok: true,
      itemCount: tenants.data.data.items.length,
      message: tenants.data?.message,
    });
  } else {
    if (tenants.status === 401) {
      throw new Error('tenants 不应返回 Tower JWT 401');
    }
    const msg = String(tenants.data?.message || tenants.data?.error || '');
    const authGap =
      tenants.status === 502 && /登录状态已过期|未登录|用户名或密码/.test(msg);
    results.push({
      case: 'tenants-v2-auth-gap',
      ok: authGap,
      status: tenants.status,
      message: msg,
      hint: authGap
        ? '请在资源池 config 配置 csmRepairPasswordEncrypted（或 tests/.env 设 TOWER_CSM_REPAIR_PASSWORD_ENCRYPTED）'
        : undefined,
    });
    if (!authGap) {
      throw new Error(`tenants 未预期响应: HTTP ${tenants.status} ${msg}`);
    }
  }

  const passed = results.filter((r) => r.ok).length;
  const summary = { cloudId, endpoint: cloud.endpoint, passed: `${passed}/${results.length}`, results };
  console.log(JSON.stringify(summary, null, 2));
  process.exit(passed === results.length ? 0 : 1);
})().catch((e) => {
  console.error(e.message || e);
  process.exit(2);
});
