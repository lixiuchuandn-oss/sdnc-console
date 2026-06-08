/**
 * Cloudmap 资源池：虚拟机列表 + SSE 推送 + 定时合并 vm_status 缓冲。
 * 从 PoolDetailPage 抽出，便于单测与复用（例如将来独立 ecs 路由页）。
 */
import React, { useEffect, useRef, useState } from 'react';
import { API_BASE_URL } from '../api';
import { getToken } from '../../../../../../utils/tokenStorage';
import {
  applyPendingAliasToVmRow,
  HARVESTER_VM_ALIAS_APPLIED_EVENT,
  mergeTowerAliasIntoVmList,
  vmAliasInventoryKey,
  type VmAliasAppliedDetail,
} from '../../../Harvester/ecs/lib/vmTowerAlias';
import {
  ecsRowIdentityKeys,
  indexEcsStatusUpdate,
  pickEcsStatusUpdate,
} from './ecsRowIdentity';

export type UseCloudmapPoolEcsParams = {
  cloudId: string;
};

export type UseCloudmapPoolEcsResult = {
  ecs: any[];
  setEcs: React.Dispatch<React.SetStateAction<any[]>>;
  rawEcs: any | null;
  setRawEcs: React.Dispatch<React.SetStateAction<any | null>>;
};

export function useCloudmapPoolEcs({
  cloudId,
}: UseCloudmapPoolEcsParams): UseCloudmapPoolEcsResult {
  const [ecs, setEcs] = useState<any[]>([]);
  const [rawEcs, setRawEcs] = useState<any | null>(null);
  const vmStatusBuffer = useRef<Map<string, any>>(new Map());
  const pendingVmAliasRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    vmStatusBuffer.current.clear();
    pendingVmAliasRef.current.clear();
  }, [cloudId]);

  useEffect(() => {
    const onAliasApplied = (ev: Event) => {
      const d = (ev as CustomEvent<VmAliasAppliedDetail>).detail;
      if (!d?.namespace || !d?.name || !d?.alias) return;
      const key = vmAliasInventoryKey(d.namespace, d.name);
      pendingVmAliasRef.current.set(key, String(d.alias).trim());
      setEcs((prev) => mergeTowerAliasIntoVmList(prev, d.namespace, d.name, d.alias));
    };
    window.addEventListener(HARVESTER_VM_ALIAS_APPLIED_EVENT, onAliasApplied);
    return () => window.removeEventListener(HARVESTER_VM_ALIAS_APPLIED_EVENT, onAliasApplied);
  }, []);

  useEffect(() => {
    let es: EventSource | null = null;
    try {
      const token = getToken();
      if (!token) {
        console.warn('[SSE] No auth token found, skipping connection.');
        return;
      }
      const urlObj = new URL(
        `${API_BASE_URL}/api/clouds/${cloudId}/resources/ecs/stream`,
      );
      urlObj.searchParams.append('token', token);
      urlObj.searchParams.append('t', String(Date.now()));
      es = new EventSource(urlObj.toString());

      es.addEventListener('vms', (ev: MessageEvent) => {
        try {
          const json = JSON.parse(String(ev.data || '{}'));
          const items: any[] = Array.isArray(json?.items) ? json.items : [];
          const pending = pendingVmAliasRef.current;
          setEcs(items.map((row) => applyPendingAliasToVmRow(row, pending)));
        } catch {}
      });

      es.addEventListener('vm_created', (ev: MessageEvent) => {
        try {
          const json = JSON.parse(String(ev.data || '{}'));
          const r = json?.item;
          if (!r) return;
          setEcs((prev) => {
            const iid = String(r?.InstanceId || r?.id || '');
            if (!iid) return prev;
            if (
              (prev || []).some(
                (x: any) => String(x?.InstanceId || x?.id || '') === iid,
              )
            )
              return prev;
            const pending = pendingVmAliasRef.current;
            const merged = applyPendingAliasToVmRow(r, pending);
            return [merged, ...(prev || [])];
          });
        } catch {}
      });

      es.addEventListener('vm_deleted', (ev: MessageEvent) => {
        try {
          const json = JSON.parse(String(ev.data || '{}'));
          const keys = ecsRowIdentityKeys({
            id: json?.iid,
            InstanceId: json?.instanceId,
            metadata: json?.metadata,
          });
          if (keys.length === 0) return;
          const keySet = new Set(keys);
          setEcs((prev) =>
            (prev || []).filter(
              (x: any) => !ecsRowIdentityKeys(x).some((k) => keySet.has(k)),
            ),
          );
        } catch {}
      });

      es.addEventListener('vm_status', (ev: MessageEvent) => {
        try {
          const json = JSON.parse(String(ev.data || '{}'));
          if (!json?.iid && !json?.instanceId && !json?.metadata) return;
          indexEcsStatusUpdate(vmStatusBuffer.current, json);
        } catch {}
      });

      es.addEventListener('stream_error', (ev: MessageEvent) => {
        try {
          const json = JSON.parse(String(ev.data || '{}'));
          const message = String(json?.message ?? '');
          const cause = String(json?.cause ?? '');
          const s = `${message} ${cause}`.toLowerCase();
          if (
            s.includes('aborted') ||
            s.includes('context canceled') ||
            s.includes('context cancelled') ||
            s.includes('canceled') ||
            s.includes('cancelled') ||
            s.includes('client disconnected') ||
            s.includes('connection closed') ||
            s.includes('broken pipe') ||
            s.includes('eof')
          ) {
            return;
          }
          console.warn('[SSE] Server Logic Error:', message, 'Cause:', cause);
        } catch (e) {
          console.warn('[SSE] Server Logic Error (Raw):', ev);
        }
      });

      es.onerror = () => {};
    } catch (e) {
      console.error('[SSE] Init failed', e);
    }
    return () => {
      try {
        es?.close();
      } catch {}
    };
  }, [cloudId]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (vmStatusBuffer.current.size === 0) return;

      const updates = new Map(vmStatusBuffer.current);
      vmStatusBuffer.current.clear();

      setEcs((prev) => {
        let hasChanges = false;
        const next = (prev || []).map((x: any) => {
          const json = pickEcsStatusUpdate(x, updates);
          if (json) {
            const statusStr = String(json?.status || '');
            const nodeName = String(json?.nodeName || '');
            const ips = Array.isArray(json?.ips) ? json.ips : [];

            const currentStatus = String(
              x?.status?.printableStatus || x?.status?.phase || x?.Status || '',
            );
            const currentNode = String(
              x?.vmi?.status?.nodeName ||
                x?.Extra?.NodeName ||
                x?.nodeName ||
                x?.status?.nodeName ||
                '',
            );

            const currentIps = x?.ips || [];
            const ipsChanged =
              ips.length !== currentIps.length ||
              ips.some((ip: string) => !currentIps.includes(ip));

            if (
              currentStatus === statusStr &&
              currentNode === nodeName &&
              !ipsChanged
            ) {
              return x;
            }

            hasChanges = true;
            const newItem = { ...x };

            newItem.Status = statusStr;
            if (typeof newItem.status === 'object' && newItem.status !== null) {
              newItem.status = {
                ...newItem.status,
                printableStatus: statusStr,
                phase: statusStr,
              };
            } else {
              newItem.status = { printableStatus: statusStr, phase: statusStr };
            }

            if (!newItem.Extra) newItem.Extra = {};
            newItem.Extra.NodeName = nodeName;
            newItem.nodeName = nodeName;

            newItem.vmi = {
              ...(x.vmi || {}),
              status: {
                ...(x.vmi?.status || {}),
                nodeName,
              },
            };

            if (typeof newItem.status === 'object' && newItem.status !== null) {
              newItem.status = { ...newItem.status, nodeName };
            }

            if (ips.length > 0) {
              newItem.ips = ips;
            }

            return newItem;
          }
          return x;
        });
        return hasChanges ? next : prev;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  return { ecs, setEcs, rawEcs, setRawEcs };
}
