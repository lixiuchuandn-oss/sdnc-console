/**
 * Cloudmap 资源池：虚拟机列表 + SSE 推送 + 定时合并 vm_status 缓冲。
 * 从 PoolDetailPage 抽出，便于单测与复用（例如将来独立 ecs 路由页）。
 */
import React, { useEffect, useRef, useState } from 'react';
import { API_BASE_URL } from '../api';
import { getToken } from '../../../../../../utils/tokenStorage';

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

  useEffect(() => {
    vmStatusBuffer.current.clear();
  }, [cloudId]);

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
          setEcs(items);
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
            return [r, ...(prev || [])];
          });
        } catch {}
      });

      es.addEventListener('vm_deleted', (ev: MessageEvent) => {
        try {
          const json = JSON.parse(String(ev.data || '{}'));
          const iid = String(json?.iid || '');
          if (!iid) return;
          setEcs((prev) =>
            (prev || []).filter(
              (x: any) => String(x?.InstanceId || x?.id || '') !== iid,
            ),
          );
        } catch {}
      });

      es.addEventListener('vm_status', (ev: MessageEvent) => {
        try {
          const json = JSON.parse(String(ev.data || '{}'));
          const iid = String(json?.iid || '');
          if (!iid) return;
          vmStatusBuffer.current.set(iid, json);
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
          const xiid = String(x?.InstanceId || x?.id || '');
          if (updates.has(xiid)) {
            const json = updates.get(xiid);
            const statusStr = String(json?.status || '');
            const nodeName = String(json?.nodeName || '');
            const ips = Array.isArray(json?.ips) ? json.ips : [];

            const currentStatus = String(
              x?.status?.printableStatus || x?.status?.phase || x?.Status || '',
            );
            const currentNode = String(
              x?.vmi?.status?.nodeName ||
                x?.status?.nodeName ||
                x?.Extra?.NodeName ||
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

            if (!newItem.vmi) newItem.vmi = { status: {} };
            if (!newItem.vmi.status) newItem.vmi.status = {};
            newItem.vmi.status.nodeName = nodeName;

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
