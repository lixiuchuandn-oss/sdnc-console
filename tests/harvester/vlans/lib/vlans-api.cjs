const {
  VLAN_ALIAS_KEY,
  generateVlanCrName,
  createVlan,
  fetchVlans,
  resolveProviderNetworkName,
  pickUnusedVlanId,
  findVlanByAlias,
  deleteVlan,
  deleteVlansByAliasPrefix,
} = require('../../lib/kube-ovn-e2e.cjs');

module.exports = {
  createVlan,
  fetchVlans,
  resolveProviderNetworkName,
  pickUnusedVlanId,
  findVlanByAlias,
  deleteVlan,
  deleteVlansByAliasPrefix,
  generateVlanCrName,
  VLAN_ALIAS_KEY,
};
