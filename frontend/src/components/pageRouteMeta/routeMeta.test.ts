import { buildAutoCrumbs, findRouteSpec, normalizePath, pathMatch } from './routeMeta';

describe('pageRouteMeta', () => {
  it('normalizePath 去掉末尾斜杠', () => {
    expect(normalizePath('/admin/users/')).toBe('/admin/users');
    expect(normalizePath('')).toBe('/');
  });

  it('pathMatch 支持参数化路由', () => {
    expect(pathMatch('/admin/clouds/:id', '/admin/clouds/abc')).toBe(true);
    expect(pathMatch('/admin/clouds/:id', '/admin/clouds/abc/extra')).toBe(false);
  });

  it('findRouteSpec 命中已知 admin 路由', () => {
    const spec = findRouteSpec('/admin/dashboard');
    expect(spec?.path).toBe('/admin/dashboard');
  });

  it('buildAutoCrumbs 自定义 breadcrumb 优先', () => {
    const custom = [{ label: '自定义' }];
    expect(buildAutoCrumbs('/admin/settings/users', custom)).toBe(custom);
  });
});
