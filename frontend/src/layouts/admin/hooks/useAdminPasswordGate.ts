import { useChangePasswordGate } from '../../shared/hooks/useChangePasswordGate';

/** 管理端壳：强制改密仅作用于非 tenant 系统用户 */
export function useAdminPasswordGate() {
  return useChangePasswordGate('system');
}
