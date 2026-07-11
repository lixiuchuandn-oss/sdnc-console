/**
 * SDNC 权限检查器
 */

import { PermissionRegistry } from './registry';
import { InheritanceEngine } from './inheritance';

function inheritedGrantMatchesRequiredVerb(userPerm: string, required: string): boolean {
  const [, reqVerb] = String(required || '').split(':');
  if (reqVerb !== 'write') return true;
  const [, heldVerb] = String(userPerm || '').split(':');
  return heldVerb === 'write' || heldVerb === 'admin' || String(userPerm || '').endsWith(':*');
}

export class PermissionChecker {
  private registry: PermissionRegistry;
  private inheritanceEngine: InheritanceEngine;

  constructor(registry: PermissionRegistry, inheritanceEngine: InheritanceEngine) {
    this.registry = registry;
    this.inheritanceEngine = inheritanceEngine;
  }

  check(permissions: string[], required: string): boolean {
    if (!permissions?.length) {
      return false;
    }

    if (permissions.includes('*')) {
      return true;
    }

    if (permissions.includes(required)) {
      return true;
    }

    const [base, verb] = required.split(':');
    if (base && verb) {
      const segments = base.split('.');
      if (segments.length >= 1 && permissions.includes(`${segments[0]}:*`)) {
        return true;
      }
      if (segments.length >= 2 && permissions.includes(`${segments[0]}.${segments[1]}:*`)) {
        return true;
      }
    }

    const inherited = this.inheritanceEngine.getInheritedPermissions(required);
    if (
      inherited.some(
        (perm) => permissions.includes(perm) && inheritedGrantMatchesRequiredVerb(perm, required),
      )
    ) {
      return true;
    }

    const implied = this.inheritanceEngine.getImpliedPermissions(permissions);
    if (implied.includes(required)) {
      return true;
    }

    if (verb === 'read' && base) {
      const writePerm = `${base}:write`;
      if (this.check(permissions, writePerm)) {
        return true;
      }
    }

    return false;
  }

  checkAny(permissions: string[], required: string[]): boolean {
    return required.some((perm) => this.check(permissions, perm));
  }

  checkAll(permissions: string[], required: string[]): boolean {
    return required.every((perm) => this.check(permissions, perm));
  }

  getMissingPermissions(permissions: string[], required: string[]): string[] {
    return required.filter((perm) => !this.check(permissions, perm));
  }
}
