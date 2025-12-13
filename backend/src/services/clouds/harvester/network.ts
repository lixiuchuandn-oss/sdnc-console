import { HarvesterTestParams } from './types';
import { getJsonOnce } from './utils';

export const listHarvesterNADsStandard = async ({ endpoint, token, insecure = false }: HarvesterTestParams): Promise<any[]> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  const candidates = [
    `${origin}/v1/harvester/k8s.cni.cncf.io.networkattachmentdefinitions`,
    `${origin}/v1/harvester/k8s.cni.cncf.io.network-attachment-definitions`
  ];
  let json: any = null;
  let lastErr: any = null;
  for (const url of candidates) {
    try {
      json = await getJsonOnce(url, token, insecure);
      if (json) break;
    } catch (e: any) {
      lastErr = e;
    }
  }
  if (!json) {
    const nsCandidates = ['default','kube-system'];
    for (const ns of nsCandidates) {
      for (const baseUrl of candidates) {
        const u = /\?/.test(baseUrl) ? `${baseUrl}&namespace=${encodeURIComponent(ns)}` : `${baseUrl}?namespace=${encodeURIComponent(ns)}`;
        try {
          json = await getJsonOnce(u, token, insecure);
          if (json) break;
        } catch (e: any) {
          lastErr = e;
        }
      }
      if (json) break;
    }
  }
  if (!json && lastErr) {
    const s = Number((lastErr as any)?.status || 0);
    const m = String((lastErr as any)?.message || '').toLowerCase();
    const b = String((lastErr as any)?.body || '').toLowerCase();
    if (s===401||m.includes('unauthorized')||b.includes('unauthorized')) return [];
    if (s===404||m.includes('not found')||b.includes('not found')) return [];
    throw lastErr;
  }
  const arr = (function(){
    const top = Array.isArray(json?.data) ? json?.data : Array.isArray(json?.items) ? json?.items : [];
    if (Array.isArray(top) && top.length > 0) return top;
    const nested = Array.isArray(json?.data?.data) ? json?.data?.data : [];
    return nested;
  })();
  return arr.map((nad: any) => ({
    name: nad?.metadata?.name || nad?.name || '',
    namespace: nad?.metadata?.namespace || nad?.namespace || '',
    config: nad?.spec?.config || ''
  }));
};

export const listKubeOvnVpcs = async ({ endpoint, token, insecure = false }: HarvesterTestParams): Promise<any[]> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try { const u = new URL(base); origin = `${u.protocol}//${u.host}`; } catch { origin = base.replace(/\/v[0-9].*$/, ''); }
  const candidates = [
    `${origin}/apis/kubeovn.io/v1/vpcs`
  ];
  let json:any=null; let lastErr:any=null;
  for (const url of candidates) { try { json = await getJsonOnce(url, token, insecure); if (json) break; } catch(e:any){ lastErr=e; } }
  if (!json && lastErr) { const s=Number(lastErr?.status||0); const m=String(lastErr?.message||'').toLowerCase(); const b=String(lastErr?.body||'').toLowerCase(); if (s===401||m.includes('unauthorized')||b.includes('unauthorized')) return []; if (s===404||m.includes('not found')||b.includes('not found')) return []; throw lastErr; }
  const items = Array.isArray(json?.items) ? json?.items : Array.isArray(json?.data) ? json?.data : [];
  return items.map((v:any)=> ({
    name: v?.metadata?.name || v?.name || '',
    namespaces: Array.isArray(v?.spec?.namespaces) ? v.spec.namespaces : [],
    standalone: !!v?.spec?.standalone,
    staticRoutes: Array.isArray(v?.spec?.staticRoutes) ? v.spec.staticRoutes.length : 0,
    createdAt: v?.metadata?.creationTimestamp || ''
  }));
};

export const listKubeOvnSubnets = async ({ endpoint, token, insecure = false }: HarvesterTestParams): Promise<any[]> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try { const u = new URL(base); origin = `${u.protocol}//${u.host}`; } catch { origin = base.replace(/\/v[0-9].*$/, ''); }
  const candidates = [
    `${origin}/apis/kubeovn.io/v1/subnets`
  ];
  let json:any=null; let lastErr:any=null;
  for (const url of candidates) { try { json = await getJsonOnce(url, token, insecure); if (json) break; } catch(e:any){ lastErr=e; } }
  if (!json && lastErr) { const s=Number(lastErr?.status||0); const m=String(lastErr?.message||'').toLowerCase(); const b=String(lastErr?.body||'').toLowerCase(); if (s===401||m.includes('unauthorized')||b.includes('unauthorized')) return []; if (s===404||m.includes('not found')||b.includes('not found')) return []; throw lastErr; }
  const items = Array.isArray(json?.items) ? json?.items : Array.isArray(json?.data) ? json?.data : [];
  return items.map((s:any)=> ({
    name: s?.metadata?.name || s?.name || '',
    vpc: s?.spec?.vpc || '',
    cidr: s?.spec?.cidrBlock || s?.spec?.cidr || '',
    gateway: s?.spec?.gateway || s?.spec?.gateway || '',
    protocol: s?.spec?.protocol || 'IPV4',
    nat: !!s?.spec?.nat,
    allowDhcp: s?.spec?.enableDHCP || s?.spec?.dhcp || false,
    createdAt: s?.metadata?.creationTimestamp || ''
  }));
};
