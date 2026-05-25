/** 租户控制台：与后端 `mergePublicScenarioNamespaces` 对齐；undefined 表示不传（非租户/兼容旧行为） */
export function appendMergePublicScenarioParam(
  params: URLSearchParams,
  mergePublicScenarioNamespaces?: boolean,
) {
  if (mergePublicScenarioNamespaces === undefined) return;
  params.set('mergePublicScenarioNamespaces', mergePublicScenarioNamespaces ? 'true' : 'false');
}
