import { useAuth } from 'contexts/AuthContext';
import { hasPermissionForAction } from 'utils/accessMapping';

/** VR 控制台写操作 RBAC（与独立菜单 networks.* 权限对齐） */
export type IbrConsoleWriteAction =
	| 'networks.vr-config:write'
	| 'networks.acl:write'
	| 'networks.nat:write'
	| 'networks.ipsec:write';

export function useIbrConsoleWritePermission(action: IbrConsoleWriteAction): boolean {
	const { user } = useAuth();
	const perms = (user?.permissions ?? []) as string[];
	return user?.role === 'super_admin' || hasPermissionForAction(perms, action);
}
