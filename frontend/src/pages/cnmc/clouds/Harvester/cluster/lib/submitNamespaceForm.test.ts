import {
  collectDuplicatePairKeys,
  labelPairsToRecord,
  namespaceRecordToFormValues,
  submitNamespaceForm,
} from './submitNamespaceForm';

describe('submitNamespaceForm helpers', () => {
  describe('labelPairsToRecord', () => {
    it('ignores empty keys', () => {
      expect(
        labelPairsToRecord([
          { key: 'a', value: '1' },
          { key: '', value: 'x' },
          { key: 'b', value: '2' },
        ]),
      ).toEqual({ a: '1', b: '2' });
    });
  });

  describe('collectDuplicatePairKeys', () => {
    it('returns duplicated keys', () => {
      expect(
        collectDuplicatePairKeys([{ key: 'a' }, { key: 'b' }, { key: 'a' }]),
      ).toEqual(['a']);
    });
  });

  describe('namespaceRecordToFormValues', () => {
    it('maps metadata labels and annotations to sorted pairs', () => {
      const form = namespaceRecordToFormValues({
        metadata: {
          name: 'proj-a',
          labels: { b: '2', a: '1' },
          annotations: { note: 'hello' },
        },
      });
      expect(form.name).toBe('proj-a');
      expect(form.labelPairs).toEqual([
        { key: 'a', value: '1' },
        { key: 'b', value: '2' },
      ]);
      expect(form.annotationPairs).toEqual([{ key: 'note', value: 'hello' }]);
    });
  });

  describe('submitNamespaceForm validation', () => {
    it('rejects system namespace names', async () => {
      const result = await submitNamespaceForm({
        cloudId: 'cloud-1',
        isEdit: false,
        values: { name: 'kube-system', labelPairs: [], annotationPairs: [] },
      });
      expect(result).toMatchObject({ ok: false, reason: 'validation' });
    });

    it('rejects duplicate label keys', async () => {
      const result = await submitNamespaceForm({
        cloudId: 'cloud-1',
        isEdit: false,
        values: {
          name: 'my-proj',
          labelPairs: [{ key: 'env', value: 'a' }, { key: 'env', value: 'b' }],
          annotationPairs: [],
        },
      });
      expect(result).toMatchObject({ ok: false, reason: 'validation' });
    });
  });
});
