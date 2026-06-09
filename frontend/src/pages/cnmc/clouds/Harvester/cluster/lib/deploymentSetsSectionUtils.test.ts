import {
  DEPLOYMENT_SET_NAME_MAX_LENGTH,
  buildDeploymentSetNamespaceOptions,
  filterDeploymentSets,
  getDeploymentSetNameValidationError,
  labelsFormListToRecord,
  labelsRecordToFormList,
  validateDeploymentSetNameField,
} from './deploymentSetsSectionUtils';

describe('deploymentSetsSectionUtils', () => {
  describe('getDeploymentSetNameValidationError', () => {
    it('accepts valid k8s label-style names', () => {
      expect(getDeploymentSetNameValidationError('rack-a')).toBeNull();
      expect(getDeploymentSetNameValidationError('a1')).toBeNull();
      expect(getDeploymentSetNameValidationError('a.b_c-9')).toBeNull();
    });

    it('rejects empty when required', () => {
      expect(getDeploymentSetNameValidationError('')).toBe('请输入部署集名称');
      expect(getDeploymentSetNameValidationError('  ')).toBe('请输入部署集名称');
    });

    it('allows empty when allowEmpty', () => {
      expect(getDeploymentSetNameValidationError('', { allowEmpty: true })).toBeNull();
    });

    it('rejects chinese, spaces, and invalid edges', () => {
      expect(getDeploymentSetNameValidationError('部署集')).toMatch(/格式无效/);
      expect(getDeploymentSetNameValidationError('rack a')).toMatch(/格式无效/);
      expect(getDeploymentSetNameValidationError('-bad')).toMatch(/格式无效/);
      expect(getDeploymentSetNameValidationError('bad-')).toMatch(/格式无效/);
    });

    it('rejects names longer than max length', () => {
      const long = 'a'.repeat(DEPLOYMENT_SET_NAME_MAX_LENGTH + 1);
      expect(getDeploymentSetNameValidationError(long)).toMatch(/不能超过/);
    });
  });

  describe('validateDeploymentSetNameField', () => {
    it('skips empty and rejects invalid', async () => {
      await expect(validateDeploymentSetNameField(null, '')).resolves.toBeUndefined();
      await expect(validateDeploymentSetNameField(null, '北京')).rejects.toThrow(/格式无效/);
    });
  });

  describe('labels helpers', () => {
    it('labelsRecordToFormList maps entries', () => {
      expect(labelsRecordToFormList({ zone: 'a', env: 'prod' })).toEqual([
        { key: 'zone', value: 'a' },
        { key: 'env', value: 'prod' },
      ]);
      expect(labelsRecordToFormList()).toEqual([]);
    });

    it('labelsFormListToRecord skips blank keys', () => {
      expect(
        labelsFormListToRecord([
          { key: 'zone', value: 'a' },
          { key: '', value: 'skip' },
          { key: 'env', value: 'prod' },
        ]),
      ).toEqual({ zone: 'a', env: 'prod' });
    });
  });

  describe('filterDeploymentSets', () => {
    const rows = [
      { name: 'ds-a', namespace: 'default', description: 'alpha' },
      { name: 'ds-b', namespace: 'kube-system', description: 'beta' },
    ] as import('services/harvester/deploymentSets').DeploymentSetRow[];

    it('filters by namespace and keyword', () => {
      expect(filterDeploymentSets(rows, { namespace: 'default' })).toHaveLength(1);
      expect(filterDeploymentSets(rows, { keyword: 'beta' })).toHaveLength(1);
      expect(filterDeploymentSets(rows, { keyword: 'kube' })).toHaveLength(1);
    });
  });

  describe('buildDeploymentSetNamespaceOptions', () => {
    it('returns sorted unique namespaces', () => {
      const rows = [
        { namespace: 'z-ns' },
        { namespace: 'default' },
        { namespace: 'default' },
        { namespace: 'a-ns' },
      ] as import('services/harvester/deploymentSets').DeploymentSetRow[];
      expect(buildDeploymentSetNamespaceOptions(rows)).toEqual([
        { value: 'a-ns', label: 'a-ns' },
        { value: 'default', label: 'default' },
        { value: 'z-ns', label: 'z-ns' },
      ]);
    });
  });
});
