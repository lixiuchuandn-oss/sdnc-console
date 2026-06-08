import type { LicensePayload, LicenseStatus } from '../contexts/LicenseContext';
import type { RouteSpec } from '../routes/RouteSpec';

export type LicenseEdition = LicensePayload['type'];

export function getLicenseEdition(license: LicenseStatus): LicenseEdition | null {
  if (!license.active || !license.payload) return null;
  return license.payload.type;
}

export function isEnterpriseLicenseStatus(license: LicenseStatus): boolean {
  return getLicenseEdition(license) === 'enterprise';
}

export function routeLicenseAllowed(
  spec: RouteSpec | undefined,
  gate: { hasFeature: (f: string) => boolean; isEnterpriseLicense: () => boolean },
): boolean {
  if (!spec) return true;
  if (spec.requiredFeature && !gate.hasFeature(spec.requiredFeature)) return false;
  if (spec.requiredLicenseType === 'enterprise' && !gate.isEnterpriseLicense()) return false;
  return true;
}
