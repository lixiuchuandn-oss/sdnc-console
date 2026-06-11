/** Harbor 项目 metadata 常见结构 */
type HarborProjectMetadata = Record<string, unknown> & {
  public?: unknown;
};

/**
 * 判断 Harbor 项目是否为公开项目
 * Harbor 可能返回：project.public=true、metadata.public="true" 或 metadata.public={ value: "true" }
 */
export function isHarborProjectPublic(project?: {
  public?: boolean;
  metadata?: HarborProjectMetadata;
}): boolean {
  if (!project) return false;
  if (project.public === true) return true;

  const metaPublic = project.metadata?.public;
  if (metaPublic === 'true' || metaPublic === 'public') return true;
  if (typeof metaPublic === 'object' && metaPublic !== null && 'value' in metaPublic) {
    const value = String((metaPublic as { value?: unknown }).value ?? '').toLowerCase();
    return value === 'true' || value === 'public';
  }

  return false;
}
