import {
  VM_AUTO_SCHEDULED_ANNOTATION_KEY,
  VM_AUTO_SCHEDULED_ANNOTATION_VALUE,
  buildVmAutoScheduledAnnotations,
  shouldWriteVmAutoScheduledAnnotation,
} from './vmAutoScheduledAnnotation';

describe('vmAutoScheduledAnnotation', () => {
  it('buildVmAutoScheduledAnnotations returns metric auto-scheduled key', () => {
    expect(buildVmAutoScheduledAnnotations()).toEqual({
      [VM_AUTO_SCHEDULED_ANNOTATION_KEY]: VM_AUTO_SCHEDULED_ANNOTATION_VALUE,
    });
  });

  it('shouldWriteVmAutoScheduledAnnotation requires auto hostMode and checked', () => {
    expect(shouldWriteVmAutoScheduledAnnotation('auto', true)).toBe(true);
    expect(shouldWriteVmAutoScheduledAnnotation('auto', false)).toBe(false);
    expect(shouldWriteVmAutoScheduledAnnotation('node', true)).toBe(false);
  });
});
