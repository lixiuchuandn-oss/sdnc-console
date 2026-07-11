import {
	HA_GROUP_ELIGIBLE_ROLES,
	isHaGroupEligibleIbrRole,
	isPeLikeIbrRole,
} from './haGroupWizardLib';

describe('haGroupWizardLib role scope', () => {
	it('allows CE and 标准 only', () => {
		expect(HA_GROUP_ELIGIBLE_ROLES).toEqual(['CE', '标准']);
		expect(isHaGroupEligibleIbrRole('CE')).toBe(true);
		expect(isHaGroupEligibleIbrRole('标准')).toBe(true);
	});

	it('rejects PE-like and other roles', () => {
		expect(isPeLikeIbrRole('PE')).toBe(true);
		expect(isPeLikeIbrRole('SPOKE_PE')).toBe(true);
		expect(isPeLikeIbrRole('HUB_PE')).toBe(true);
		expect(isHaGroupEligibleIbrRole('SPOKE_PE')).toBe(false);
		expect(isHaGroupEligibleIbrRole('HUB_PE')).toBe(false);
		expect(isHaGroupEligibleIbrRole('SASE')).toBe(false);
		expect(isHaGroupEligibleIbrRole('')).toBe(false);
	});
});
