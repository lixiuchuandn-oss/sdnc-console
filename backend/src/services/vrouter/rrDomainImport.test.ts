import fs from 'fs';
import path from 'path';
import { parseCsvRows, parseRrDomainImportCsv, previewToUpsertInputs } from './rrDomainImport';

describe('rrDomainImport', () => {
  it('parses bundled template without errors', () => {
    const templatePath = path.join(
      __dirname,
      '..',
      '..',
      '..',
      '..',
      'docs',
      'templates',
      'rr-domain-import-template.csv',
    );
    const csv = fs.readFileSync(templatePath, 'utf8');
    const preview = parseRrDomainImportCsv(csv);
    expect(preview.errors).toEqual([]);
    expect(preview.domains.length).toBe(2);
    expect(preview.domains[0].nodes.length).toBe(2);
    const inputs = previewToUpsertInputs(preview);
    expect(inputs[0].nodes.length).toBe(2);
  });

  it('parseCsvRows handles quoted commas', () => {
    const rows = parseCsvRows('a,"b,c",d\n1,2,3');
    expect(rows).toEqual([
      ['a', 'b,c', 'd'],
      ['1', '2', '3'],
    ]);
  });

  it('rejects duplicate RR name in same domain', () => {
    const csv = `域标识,域名称,域备注,域级对端ASN,域级本端ASN,RR名称,邻居地址,对端ASN,本端ASN,ClusterID,RouterID,优先级,备注
x,域,,65001,65000,R1,1.1.1.1,,,,,1,
x,域,,65001,65000,R1,1.1.1.2,,,,,2,`;
    const preview = parseRrDomainImportCsv(csv);
    expect(preview.errors.some((e) => e.includes('RR 名称重复'))).toBe(true);
  });
});
