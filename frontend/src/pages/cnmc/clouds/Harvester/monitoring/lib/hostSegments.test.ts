import { parseNodesToHostSegments } from './hostSegments';

describe('hostSegments', () => {
  const readyNode = {
    metadata: { name: 'n1' },
    status: { conditions: [{ type: 'Ready', status: 'True' }] },
  };

  it('counts active nodes', () => {
    const { segments, total } = parseNodesToHostSegments({ items: [readyNode] });
    expect(total).toBe(1);
    expect(segments.find((s) => s.key === 'active')?.count).toBe(1);
  });

  it('counts maintenance nodes', () => {
    const node = {
      metadata: {
        annotations: { 'harvesterhci.io/maintain-status': 'completed' },
      },
      status: { conditions: [{ type: 'Ready', status: 'True' }] },
    };
    const { segments } = parseNodesToHostSegments({ data: { items: [node] } });
    expect(segments.find((s) => s.key === 'maintenance')?.count).toBe(1);
  });

  it('counts cordoned nodes', () => {
    const node = {
      metadata: { labels: { 'kubevirt.io/schedulable': 'false' } },
      status: { conditions: [{ type: 'Ready', status: 'True' }] },
    };
    const { segments } = parseNodesToHostSegments([node]);
    expect(segments.find((s) => s.key === 'cordoned')?.count).toBe(1);
  });

  it('counts not-ready nodes as other', () => {
    const node = {
      metadata: { name: 'n2' },
      status: { conditions: [{ type: 'Ready', status: 'False' }] },
    };
    const { segments } = parseNodesToHostSegments({ items: [node] });
    expect(segments.find((s) => s.key === 'other')?.count).toBe(1);
  });
});
