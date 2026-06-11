const fs = require('fs');
const path = require('path');

const readmePath = path.join(__dirname, '..', 'README.md');
let text = fs.readFileSync(readmePath, 'utf8');
if (!text.includes('test:vlans:api')) {
  text = text.replace(
    'npm run test:security-groups:browser:lifecycle\r\n```',
    'npm run test:security-groups:browser:lifecycle\r\nnpm run test:vlans:api\r\nnpm run test:vlans:browser\r\nnpm run test:public-subnets:api\r\nnpm run test:public-subnets:browser\r\n```',
  );
}
if (!text.includes('TOWER_VLAN_ALIAS_PREFIX')) {
  text = text.replace(
    '部署集 / 安全组可选环境变量：`TOWER_DS_NAME_PREFIX`、`TOWER_DS_SET_NAME`、`TOWER_SG_NAME_PREFIX`、`TOWER_SG_GROUP_NAME`、`TOWER_SG_SUBNET_NAME`。\r\n',
    '部署集 / 安全组可选环境变量：`TOWER_DS_NAME_PREFIX`、`TOWER_DS_SET_NAME`、`TOWER_SG_NAME_PREFIX`、`TOWER_SG_GROUP_NAME`、`TOWER_SG_SUBNET_NAME`。\r\n\r\nVLAN / 公共子网 E2E 仅清理 `tower-e2e-vlan*` / `tower-e2e-pub-sn*` 别名资源；引用存量物理网络（`TOWER_PN_NAME` 可选）。环境变量：`TOWER_VLAN_ALIAS_PREFIX`、`TOWER_PUBLIC_SN_ALIAS_PREFIX`。\r\n',
  );
}
fs.writeFileSync(readmePath, text, 'utf8');
console.log('patched README');
