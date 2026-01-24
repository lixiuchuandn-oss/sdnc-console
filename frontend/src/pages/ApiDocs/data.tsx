import React from 'react';
import { Tag, Typography, Space, Divider } from 'antd';
import { MethodBadge } from './MethodBadge';

const { Text, Paragraph } = Typography;

export interface Endpoint {
  title: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path?: string;
  desc: React.ReactNode;
  params?: string; // JSON string or text for pre block
  extra?: React.ReactNode; // Custom content
}

export interface Section {
  id: string;
  title: string;
  intro?: React.ReactNode;
  endpoints?: Endpoint[];
  children?: Section[];
}

export interface PageData {
  title: string;
  desc: string;
  sections: Section[];
}

export const docData: Record<string, PageData> = {
  'cloud-resources': {
    title: '云资源管理 (Cloud Resources)',
    desc: '云资源模块提供对多云环境下的云主机、网络、存储等基础设施资源的统一接入与管理能力。',
    sections: [
      {
        id: 'cloud-mgmt',
        title: '1. 资源接入与管理 (Cloud Management)',
        children: [
          {
            id: 'cloud-mgmt-list',
            title: '1.1 获取列表',
            endpoints: [
              {
                title: '获取云资源列表',
                method: 'GET',
                path: '/api/clouds',
                desc: '获取已接入的云资源账户列表（敏感信息已脱敏）。'
              }
            ]
          },
          {
            id: 'cloud-mgmt-add',
            title: '1.2 接入资源',
            endpoints: [
              {
                title: '接入新云资源',
                method: 'POST',
                path: '/api/clouds',
                desc: '接入新的云厂商账户（支持 Aliyun, HuaweiCloud, Harvester, CSM 等）。',
                params: JSON.stringify({
                  "name": "MyAliyun",
                  "type": "public", 
                  "region": "cn-hangzhou",
                  "endpoint": "ecs.cn-hangzhou.aliyuncs.com",
                  "config": {
                    "provider": "aliyun",
                    "accessKey": "LTAI...",
                    "secretKey": "SECRET..."
                  }
                }, null, 2)
              }
            ]
          },
          {
            id: 'cloud-mgmt-ops',
            title: '1.3 资源操作',
            endpoints: [
               {
                title: '云资源操作',
                desc: (
                  <>
                    <Paragraph>
                      <MethodBadge method="PUT" /> <Text code>/api/clouds/:id</Text> <span style={{ marginLeft: 8 }}>更新云资源配置</span>
                    </Paragraph>
                    <Divider style={{ margin: '8px 0' }} />
                    <Paragraph>
                      <MethodBadge method="DELETE" /> <Text code>/api/clouds/:id</Text> <span style={{ marginLeft: 8 }}>移除云资源</span>
                    </Paragraph>
                    <Divider style={{ margin: '8px 0' }} />
                    <Paragraph>
                      <MethodBadge method="POST" /> <Text code>/api/clouds/:id/test</Text> <span style={{ marginLeft: 8 }}>测试连接状态</span>
                    </Paragraph>
                  </>
                )
              }
            ]
          }
        ]
      },
      {
        id: 'standard-query',
        title: '2. 标准查询接口 (Standard Query)',
        intro: (
          <Paragraph>
            标准资源接口旨在屏蔽底层多云差异，为上层应用提供统一的资源池查询与操作指令集。客户端通过获取标准化的 <Text code>QueryCommand</Text>，即可在不知道具体 URL 规则的情况下查询 VPC、VM 等资源。
          </Paragraph>
        ),
        endpoints: [
          {
            title: '获取查询指令',
            method: 'GET',
            path: '/api/clouds/:id/query-commands',
            desc: '获取指定云资源的标准化查询指令。接口返回用于查询VPC、VM等资源的HTTP请求元数据（URL、Method、Headers等）。',
            params: JSON.stringify({
              "types": ["vpc", "vm"] // 可选 query param: types=vpc,vm
            }, null, 2),
            extra: (
               <>
                 <Paragraph><Text strong>响应示例：</Text></Paragraph>
                 <pre style={{ background: '#f5f5f5', padding: 12, borderRadius: 6, fontSize: 12 }}>
{JSON.stringify({
  "message": "Success",
  "data": {
    "resourcePoolId": "cloud-1",
    "vpcQuery": {
      "description": "Query VPCs for cloud 阿里云华东1 (aliyun)",
      "type": "http_request",
      "payload": {
        "url": "/api/clouds/cloud-1/resources/vpcs",
        "method": "GET",
        "headers": { "Content-Type": "application/json" }
      }
    },
    "vmQuery": {
      "description": "Query VMs for cloud 阿里云华东1 (aliyun)",
      "type": "http_request",
      "payload": {
        "url": "/api/clouds/cloud-1/resources/ecs-all",
        "method": "GET",
        "headers": { "Content-Type": "application/json" }
      }
    }
  }
}, null, 2)}
                 </pre>
               </>
            )
          }
        ]
      },
      {
        id: 'native-proxy',
        title: '3. 原生资源代理 (Native Proxy)',
        intro: (
          <>
            <Paragraph>平台提供透传代理接口，直接调用云厂商 API 获取资源详情。</Paragraph>
            <Paragraph><Text strong>URL 模式：</Text> <Text code>/api/clouds/:id/resources/:resourceType</Text></Paragraph>
            <Paragraph>
              <Text strong>支持的资源类型 (resourceType)：</Text>
              <ul>
                <li><Text code>ecs</Text> - 云服务器实例</li>
                <li><Text code>vpcs</Text> - 专有网络 (VPC)</li>
                <li><Text code>vswitches</Text> - 交换机/子网</li>
                <li><Text code>security_groups</Text> - 安全组</li>
                <li><Text code>images</Text> - 镜像列表</li>
              </ul>
            </Paragraph>
          </>
        )
      },
      {
        id: 'csm-vr-ctl-interfaces',
        title: '4. CSM_VR_CTL 服务接口',
        intro: (
          <>
            <Paragraph>本节列出了 CSM_VR_CTL (VR Controller) 服务的核心接口，用于管理 VR 实例的生命周期与网络配置。</Paragraph>
          </>
        ),
        endpoints: [
          { title: 'VR基本信息 (VR1)', method: 'GET', path: '/V2/ctcontrol/VR1/pagelist', desc: '获取 VR 实例的基础信息列表（如 UUID、名称、状态）。' },
          { title: 'VR扩展配置 (VR3)', method: 'GET', path: '/V2/ctcontrol/VR3/VRConfig/list', desc: '获取 VR 实例的详细扩展配置列表（包含更多运行时参数）。' },
          { title: 'VR配置查询 (VRConfig)', method: 'GET', path: '/V2/ctcontrol/VR2/VRConfig', desc: '获取单个 VR 的具体网络配置。' },
          { title: 'VR配置更新 (VRConfig)', method: 'POST', path: '/V2/ctcontrol/VR2/VRConfig', desc: '下发/更新单个 VR 的具体网络配置。' }
        ]
      }
    ]
  },
  'security-mgmt': {
    title: '安全管理面 (Security Management Plane)',
    desc: '安全管理面负责构建跨多云环境的统一安全边界，管理安全域、级联通道及安全应用服务。',
    sections: [
      {
        id: 'security-domain',
        title: '1. 安全域管理',
        endpoints: [
          {
            title: '获取安全域列表',
            method: 'GET',
            path: '/api/security-domains',
            desc: '获取所有安全域配置。'
          },
          {
            title: '获取安全域详情',
            method: 'GET',
            path: '/api/security-domains/:id',
            desc: '获取安全域详情，包含关联的云实例、服务链及应用实例信息。'
          }
        ]
      },
      {
        id: 'cascade-channels',
        title: '2. 级联通道管理',
        endpoints: [
          { title: '获取级联通道列表', method: 'GET', path: '/api/cens', desc: '获取所有级联通道(CEN)实例。' },
          { title: '创建级联通道', method: 'POST', path: '/api/cens', desc: '创建新的级联通道。' },
          { title: '挂载网络实例', method: 'POST', path: '/api/cens/:id/attachments', desc: '将VPC或安全域挂载到级联通道。' }
        ]
      }
    ]
  },
  'cross-region': {
    title: '跨地域互联 (Cross-Region Interconnection)',
    desc: '跨地域互联模块提供虚拟路由器(VR)、SRv6隧道、IPsec VPN及基础网络控制能力，实现多站点间的高速互联。',
    sections: [
      {
        id: 'interconnect-vr',
        title: '1. VR实例管理',
        endpoints: [
          {
            title: '获取VR实例列表',
            method: 'GET',
            path: '/api/vr-config/pagelist',
            desc: '分页获取VR实例列表。此接口为实时接口，直接透传请求至后端控制器（CSM）获取最新的VR实例状态。支持按页码和页大小分页。',
            params: JSON.stringify({
              "page_num": 1,
              "page_size": 50
            }, null, 2)
          },
          {
            title: '创建/更新VR配置',
            method: 'POST',
            path: '/api/vr-config/upsert',
            desc: '创建新的VR配置或更新现有配置信息。如果UUID存在则更新，否则创建。配置内容（config字段）将作为JSON存储。',
            params: JSON.stringify({
              "uuid": "vr-uuid-example",
              "config": {
                "name": "MyVR",
                "interfaces": [],
                "routes": []
              }
            }, null, 2)
          },
          {
            title: '修改VR角色',
            method: 'POST',
            path: '/api/vr-config/set-role',
            desc: '修改VR实例的角色类型。不同角色对应不同的网络功能集（如PE设备、CE设备、SASE网关等）。',
            params: JSON.stringify({
              "uuid": "vr-uuid-example",
              "role": "PE" // 可选值: PE, CE, SASE, 标准
            }, null, 2)
          },
          {
            title: '绑定VR到租户',
            method: 'POST',
            path: '/api/vr-config/bind',
            desc: '将VR实例（含SASE网关）绑定到特定租户和组织。绑定后，该VR将归属于指定租户进行管理。',
            params: JSON.stringify({
              "vr_unique_id": "vr-uuid-example",
              "tenant_id": "tenant-id-123",
              "org_id": "org-id-456" // 可选
            }, null, 2)
          },
          {
            title: '删除VR配置',
            method: 'DELETE',
            path: '/api/vr-config/:uuid',
            desc: '删除指定UUID的VR配置。此操作将从数据库中移除VR的配置记录，但不会删除控制器上的实际VR实例。',
            params: JSON.stringify({
              "uuid": "vr-uuid-example"
            }, null, 2)
          },
          {
            title: '获取VR配置详情',
            method: 'GET',
            path: '/api/vr-config/:uuid',
            desc: '获取指定UUID的VR配置详情（从本地数据库读取）。返回内容包含完整的配置JSON对象。',
            params: JSON.stringify({
              "uuid": "vr-uuid-example"
            }, null, 2)
          },
          {
            title: '获取VR配置历史版本',
            method: 'GET',
            path: '/api/vr-config/version/list',
            desc: '列出某个VR在某个角色下的配置版本历史。系统会自动保留最近的5个配置版本，按时间倒序排列。',
            params: JSON.stringify({
              "uuid": "vr-uuid-example",
              "role": "PE"
            }, null, 2)
          },
          {
            title: 'VR列表缓存操作',
            desc: (
              <>
                <Paragraph>
                  <MethodBadge method="GET" /> <Text code>/api/vr-cache/pagelist</Text>
                </Paragraph>
                <Paragraph>读取本地缓存的VR列表。用于在控制器不可用或网络异常时的降级兜底展示。</Paragraph>
                <pre style={{ background: '#f5f5f5', padding: 12, borderRadius: 6, fontSize: 12 }}>
{JSON.stringify({ "page_num": 1, "page_size": 50 }, null, 2)}
                </pre>
                <Divider style={{ margin: '8px 0' }} />
                <Paragraph>
                  <MethodBadge method="POST" /> <Text code>/api/vr-cache/upsert</Text>
                </Paragraph>
                <Paragraph>将获取到的最新VR列表写入本地缓存。通常在成功调用实时列表接口后触发。</Paragraph>
                <pre style={{ background: '#f5f5f5', padding: 12, borderRadius: 6, fontSize: 12 }}>
{JSON.stringify({
  "page_num": 1,
  "page_size": 50,
  "data": { "page": [/* VR List Array */], "total": 100 }
}, null, 2)}
                </pre>
              </>
            )
          }

        ]
      },
      {
        id: 'csm-vr-ctl-interfaces',
        title: '2. CSM_VR_CTL 服务接口',
        intro: (
          <>
             <Paragraph>本节列出了 CSM_VR_CTL (VR Controller) 服务的核心接口，用于管理 VR 实例的生命周期与网络配置。</Paragraph>
          </>
        ),
        endpoints: [
          { title: 'VR基本信息 (VR1)', method: 'GET', path: '/V2/ctcontrol/VR1/pagelist', desc: '获取 VR 实例的基础信息列表（如 UUID、名称、状态）。' },
          { title: 'VR扩展配置 (VR3)', method: 'GET', path: '/V2/ctcontrol/VR3/VRConfig/list', desc: '获取 VR 实例的详细扩展配置列表（包含更多运行时参数）。' },
          { title: 'VR配置查询 (VRConfig)', method: 'GET', path: '/V2/ctcontrol/VR2/VRConfig', desc: '获取单个 VR 的具体网络配置。' },
          { title: 'VR配置更新 (VRConfig)', method: 'POST', path: '/V2/ctcontrol/VR2/VRConfig', desc: '下发/更新单个 VR 的具体网络配置。' }
        ]
      },
      {
        id: 'csm-pool-interfaces',
        title: '3. CSM 安全资源池接口',
        intro: (
          <>
             <Paragraph>本节列出了 CSM 安全资源池服务的接口，用于查询和管理底层的计算、网络与安全资源。</Paragraph>
          </>
        ),
        endpoints: [
          { title: '虚拟机列表 (VM04)', method: 'GET', path: '/V2/ctcontrol/VM04/vms', desc: '获取虚拟机资源列表。' },
          { title: '虚拟机操作', method: 'POST', path: '/V2/ctcontrol/VM04/vms/:id/:action', desc: '执行虚拟机电源操作 (start/stop/restart)。' },
          { title: '虚拟机控制台', method: 'GET', path: '/V2/ctcontrol/VM04/vms/:id/console', desc: '获取虚拟机的 VNC 控制台 URL。' },
          { title: '物理主机列表 (VM02)', method: 'GET', path: '/V2/ctcontrol/VM02/hosts', desc: '获取物理宿主机列表。' },
          { title: '物理主机详情', method: 'GET', path: '/V2/ctcontrol/VM02/host', desc: '获取指定物理主机的详细信息。' },
          { title: '虚拟交换机列表 (VM06)', method: 'GET', path: '/V2/ctcontrol/VM06/vrouters', desc: '获取虚拟交换机 (vRouter) 列表。' },
          { title: '虚拟交换机详情', method: 'GET', path: '/V2/ctcontrol/VM06/vrouter', desc: '获取指定虚拟交换机的详细信息。' },
          { title: '虚拟机组列表 (VM05)', method: 'GET', path: '/V2/ctcontrol/VM05/vm-groups', desc: '获取虚拟机组 (Element Groups) 列表。' },
          { title: '服务链列表 (VM08)', method: 'GET', path: '/V2/ctcontrol/VM08/service-chains', desc: '获取服务链列表。' },
          { title: '创建服务链', method: 'POST', path: '/V2/ctcontrol/VM08/service-chain', desc: '创建新的服务链。' },
          { title: '删除服务链', method: 'DELETE', path: '/V2/ctcontrol/VM08/service-chain', desc: '删除指定的服务链。' },
          { title: '资产(网络)列表 (VM07)', method: 'GET', path: '/V2/ctcontrol/VM07/customer/networks', desc: '获取资产（客户网络）列表。' },
          { title: '创建资产', method: 'POST', path: '/V2/ctcontrol/VM07/customer/network', desc: '创建新的资产网络信息。' },
          { title: '删除资产', method: 'DELETE', path: '/V2/ctcontrol/VM07/customer/network', desc: '删除指定的资产网络信息。' },
          { title: '资源池信息 (VM01)', method: 'GET', path: '/V2/ctcontrol/VM01/pool', desc: '获取资源池的基础信息。' },
          { title: 'SSO回调', method: 'POST', path: '/csm/api/v1.0/security/domain/attach/callOnSSO', desc: '处理单点登录回调。' },
          { title: '预认证', method: 'POST', path: '/csm/api/v1.0/authentication/auth', desc: '用户预认证接口。' }
        ]
      },
      {
        id: 'smp-apps',
        title: '4. SASE网关 (SASE Gateways)',
          endpoints: [
            {
              title: '上报网关资产',
              method: 'POST',
              path: '/api/sase/gateways/report-assets',
              desc: 'SASE网关主动上报发现的资产信息（IP/端口）。平台收到上报后，会自动将其同步至对应的安全域和CSM应用管理模块中，实现资产的自动发现与纳管。',
              params: JSON.stringify({
                "vr_unique_id": "vr-uuid-example",
                "assets": [
                  {
                    "value": "192.168.1.100",
                    "type": "ip", // 可选: ip, domain
                    "ip_type": "ipv4", // 可选: ipv4, ipv6
                    "port": "8080" // 可选
                  },
                  {
                    "value": "10.0.0.5"
                  }
                ]
              }, null, 2)
            },
            {
              title: '获取安全服务列表',
              method: 'GET',
              path: '/api/sase/gateways/info',
              desc: '查询指定 VR 实例绑定的安全域信息及可用的安全服务列表。SASE 网关通过此接口获取自身的归属配置（如所属租户、关联的云账号等）以及需要连接的安全服务链信息。',
              params: JSON.stringify({
                "vr_uuid": "vr-uuid-example"
              }, null, 2)
            }
          ]
        },
      {
        id: 'interconnect-srv6',
        title: '5. SRv6隧道管理',
        endpoints: [
          { title: '获取隧道列表', method: 'GET', path: '/api/v1/srv6', desc: '获取所有 SRv6 隧道配置。' },
          { title: '创建隧道', method: 'POST', path: '/api/v1/srv6', desc: '创建新的 SRv6 隧道 (PE-PE / CE-CE)。' }
        ]
      },
      {
        id: 'interconnect-ipsec',
        title: '6. IPsecVPN管理',
        endpoints: [
          {
            title: '获取VPN列表',
            method: 'GET',
            path: '/api/v1/ipsec?vrId=...',
            desc: '获取指定 VR 实例的 IPSec VPN 配置列表。'
          },
          {
            title: '创建VPN连接',
            method: 'POST',
            path: '/api/v1/ipsec',
            desc: '创建新的 IPSec VPN 连接。'
          }
        ]
      },
      {
        id: 'interconnect-acl',
        title: '7. ACL 访问控制列表',
        endpoints: [
          {
            title: '获取ACL规则',
            method: 'GET',
            path: '/api/v1/acl?vrId=...',
            desc: '获取指定 VR 实例的 ACL 规则列表。'
          },
          {
            title: '下发ACL规则',
            method: 'POST',
            path: '/api/v1/acl',
            desc: '向指定 VR 下发新的 ACL 规则。'
          }
        ]
      },
      {
        id: 'interconnect-nat',
        title: '8. NAT 网络地址转换',
        endpoints: [
          {
            title: '获取NAT规则',
            method: 'GET',
            path: '/api/v1/nat?vrId=...',
            desc: '获取指定VR的NAT规则。'
          },
          {
            title: '创建NAT规则',
            method: 'POST',
            path: '/api/v1/nat',
            desc: '创建新的NAT规则（SNAT/DNAT）。'
          }
        ]
      }
    ]
  },

  'csm-pool': {
    title: 'CSM资源池 (CSM Resource Pool)',
    desc: 'CSM 安全资源池接口用于查询和管理底层的计算、网络与安全资源。',
    sections: [
      {
        id: 'csm-pool-vms',
        title: '1. 虚拟机管理 (VM04)',
        endpoints: [
          { title: '虚拟机列表', method: 'GET', path: '/V2/ctcontrol/VM04/vms', desc: '获取虚拟机资源列表。' },
          { title: '虚拟机操作', method: 'POST', path: '/V2/ctcontrol/VM04/vms/:id/:action', desc: '执行虚拟机电源操作 (start/stop/restart)。' },
          { title: '虚拟机控制台', method: 'GET', path: '/V2/ctcontrol/VM04/vms/:id/console', desc: '获取虚拟机的 VNC 控制台 URL。' }
        ]
      },
      {
        id: 'csm-pool-network',
        title: '2. 网络资源管理 (VM06/VM07)',
        endpoints: [
          { title: '虚拟交换机列表', method: 'GET', path: '/V2/ctcontrol/VM06/vrouters', desc: '获取虚拟交换机 (vRouter) 列表。' },
          { title: '虚拟交换机详情', method: 'GET', path: '/V2/ctcontrol/VM06/vrouter', desc: '获取指定虚拟交换机的详细信息。' },
          { title: '资产(网络)列表', method: 'GET', path: '/V2/ctcontrol/VM07/customer/networks', desc: '获取资产（客户网络）列表。' },
          { title: '创建资产', method: 'POST', path: '/V2/ctcontrol/VM07/customer/network', desc: '创建新的资产网络信息。' },
          { title: '删除资产', method: 'DELETE', path: '/V2/ctcontrol/VM07/customer/network', desc: '删除指定的资产网络信息。' }
        ]
      },
      {
        id: 'csm-pool-service-chain',
        title: '3. 服务链管理 (VM08)',
        endpoints: [
          { title: '服务链列表', method: 'GET', path: '/V2/ctcontrol/VM08/service-chains', desc: '获取服务链列表。' },
          { title: '创建服务链', method: 'POST', path: '/V2/ctcontrol/VM08/service-chain', desc: '创建新的服务链。' },
          { title: '删除服务链', method: 'DELETE', path: '/V2/ctcontrol/VM08/service-chain', desc: '删除指定的服务链。' }
        ]
      },
      {
        id: 'csm-pool-hosts',
        title: '4. 物理资源管理 (VM01/VM02)',
        endpoints: [
          { title: '资源池信息', method: 'GET', path: '/V2/ctcontrol/VM01/pool', desc: '获取资源池的基础信息。' },
          { title: '物理主机列表', method: 'GET', path: '/V2/ctcontrol/VM02/hosts', desc: '获取物理宿主机列表。' },
          { title: '物理主机详情', method: 'GET', path: '/V2/ctcontrol/VM02/host', desc: '获取指定物理主机的详细信息。' }
        ]
      },
      {
        id: 'csm-pool-auth',
        title: '5. 认证与回调',
        endpoints: [
          { title: 'SSO回调', method: 'POST', path: '/csm/api/v1.0/security/domain/attach/callOnSSO', desc: '处理单点登录回调。' },
          { title: '预认证', method: 'POST', path: '/csm/api/v1.0/authentication/auth', desc: '用户预认证接口。' }
        ]
      }
    ]
  },

  'aliyun-resources': {
    title: '阿里云资源 (Aliyun Resources)',
    desc: '提供阿里云专有的资源查询与管理接口。这些接口直接透传至阿里云原生 API，返回结构与阿里云 OpenAPI 保持一致（包裹在 data 字段中）。',
    sections: [
      {
        id: 'aliyun-ecs',
        title: '1. 云服务器 (ECS)',
        endpoints: [
          { 
            title: '实例列表 (封装/全量)', 
            method: 'GET', 
            path: '/api/clouds/:id/resources/ecs', 
            desc: '【封装模式】默认行为。底层循环调用阿里云 DescribeInstances 接口自动轮询所有分页，返回该地域下所有 ECS 实例的聚合列表。',
            extra: (
              <>
                <Paragraph><Text strong>封装模式响应 (全量聚合)：</Text></Paragraph>
                <pre style={{ background: '#f5f5f5', padding: 12, borderRadius: 6, fontSize: 12 }}>
{JSON.stringify({
  "message": "查询成功",
  "data": {
    "TotalCount": 2,
    "Instances": {
      "Instance": [
        {
          "InstanceId": "i-bp123456",
          "InstanceName": "MyServer",
          "Status": "Running",
          "ExpiredTime": "2025-12-31T23:59:59Z"
        }
      ]
    }
  },
  "capabilities": { "supportsInstanceType": true, "supportsVpc": true }
}, null, 2)}
                </pre>
              </>
            )
          },
          { 
            title: '实例列表 (原生/分页)', 
            method: 'GET', 
            path: '/api/clouds/:id/resources/ecs', 
            desc: '【原生模式】透传调用阿里云 DescribeInstances 接口。支持 PageNumber 和 PageSize 参数，返回原生分页数据。',
            params: JSON.stringify({
              "PageNumber": 1,
              "PageSize": 10
            }, null, 2),
            extra: (
              <>
                <Paragraph><Text strong>原生模式响应 (单页数据)：</Text></Paragraph>
                <pre style={{ background: '#f5f5f5', padding: 12, borderRadius: 6, fontSize: 12 }}>
{JSON.stringify({
  "message": "查询成功",
  "data": {
    "TotalCount": 100,
    "PageNumber": 1,
    "PageSize": 10,
    "Instances": {
      "Instance": [
        { "InstanceId": "i-bp1...", "InstanceName": "Page1-Item1", "ExpiredTime": "2025-12-31T23:59:59Z" }
      ]
    }
  }
}, null, 2)}
                </pre>
              </>
            )
          },
          {
            title: '实例监控指标 (DescribeMetricData)',
            method: 'GET',
            path: '/api/clouds/:id/resources/ecs/:instanceId/metrics',
            desc: '获取指定 ECS 实例的监控指标数据（如 CPUUtilization）。底层调用阿里云 CMS DescribeMetricData 接口。',
            params: JSON.stringify({
              "metric": "CPUUtilization", // 可选，默认 CPUUtilization
              "period": 60, // 可选，默认 60s
              "start": 1620000000000, // 可选，时间戳
              "end": 1620003600000 // 可选，时间戳
            }, null, 2)
          },
          {
            title: '实例历史事件 (DescribeInstanceHistoryEvents)',
            method: 'GET',
            path: '/api/clouds/:id/resources/ecs/:instanceId/history-events',
            desc: '获取指定 ECS 实例的历史事件（如重启、维护等）。底层调用阿里云 DescribeInstanceHistoryEvents 接口。'
          },
          {
            title: '实例变更流 (SSE)',
            method: 'GET',
            path: '/api/clouds/:id/resources/ecs/stream',
            desc: '通过 Server-Sent Events (SSE) 实时推送 ECS 实例的变更事件（创建、删除、状态变化）。'
          }
        ]
      },
      {
        id: 'aliyun-vpc',
        title: '2. 专有网络 (VPC)',
        endpoints: [
          { 
            title: 'VPC 列表 (封装/全量)', 
            method: 'GET', 
            path: '/api/clouds/:id/resources/vpcs', 
            desc: '【封装模式】默认行为。底层循环调用阿里云 DescribeVpcs 接口自动轮询所有分页，返回该地域下所有 VPC 的聚合列表。',
            extra: (
              <>
                <Paragraph><Text strong>封装模式响应 (全量聚合)：</Text></Paragraph>
                <pre style={{ background: '#f5f5f5', padding: 12, borderRadius: 6, fontSize: 12 }}>
{JSON.stringify({
  "message": "查询成功",
  "data": {
    "TotalCount": 1,
    "Vpcs": {
      "Vpc": [
        {
          "VpcId": "vpc-bp12345",
          "VpcName": "MyVPC",
          "CidrBlock": "172.16.0.0/12",
          "Status": "Available"
        }
      ]
    }
  }
}, null, 2)}
                </pre>
              </>
            )
          },
          { 
            title: 'VPC 列表 (原生/分页)', 
            method: 'GET', 
            path: '/api/clouds/:id/resources/vpcs', 
            desc: '【原生模式】透传调用阿里云 DescribeVpcs 接口。支持 PageNumber 和 PageSize。',
            params: JSON.stringify({
              "PageNumber": 1,
              "PageSize": 10
            }, null, 2),
            extra: (
              <>
                <Paragraph><Text strong>原生模式响应 (单页数据)：</Text></Paragraph>
                <pre style={{ background: '#f5f5f5', padding: 12, borderRadius: 6, fontSize: 12 }}>
{JSON.stringify({
  "message": "查询成功",
  "data": {
    "TotalCount": 100,
    "PageNumber": 1,
    "PageSize": 10,
    "Vpcs": {
      "Vpc": [
        { "VpcId": "vpc-bp1...", "VpcName": "Page1-Item1" }
      ]
    }
  }
}, null, 2)}
                </pre>
              </>
            )
          },
          {
            title: '创建 VPC (CreateVpc)',
            method: 'POST',
            path: '/api/clouds/:id/resources/vpcs',
            desc: '创建新的 VPC。直接映射阿里云 CreateVpc 接口参数。',
            params: JSON.stringify({
              "CidrBlock": "192.168.0.0/16",
              "VpcName": "NewVPC",
              "Description": "Created via API",
              "EnableIpv6": false
            }, null, 2)
          },
          {
            title: '更新 VPC (ModifyVpcAttribute)',
            method: 'PATCH',
            path: '/api/clouds/:id/resources/vpcs/:vpcId',
            desc: '修改 VPC 的名称或描述。',
            params: JSON.stringify({
              "VpcName": "UpdatedName",
              "Description": "Updated description"
            }, null, 2)
          },
          {
            title: '删除 VPC (DeleteVpc)',
            method: 'DELETE',
            path: '/api/clouds/:id/resources/vpcs/:vpcId',
            desc: '删除指定的 VPC。'
          }
        ]
      },
      {
        id: 'aliyun-vswitch',
        title: '3. 交换机 (VSwitch)',
        endpoints: [
          { 
            title: '交换机列表 (封装/全量)', 
            method: 'GET', 
            path: '/api/clouds/:id/resources/vswitches', 
            desc: '【封装模式】默认行为。底层循环调用阿里云 DescribeVSwitches 接口自动轮询所有分页，返回该地域下所有 VSwitch 的聚合列表。',
            params: JSON.stringify({
              "vpcId": "vpc-bp12345" // 可选过滤
            }, null, 2)
          },
          { 
            title: '交换机列表 (原生/分页)', 
            method: 'GET', 
            path: '/api/clouds/:id/resources/vswitches', 
            desc: '【原生模式】透传调用阿里云 DescribeVSwitches 接口。支持 PageNumber 和 PageSize。',
            params: JSON.stringify({
              "PageNumber": 1,
              "PageSize": 10,
              "VpcId": "vpc-bp12345" // 可选
            }, null, 2)
          },
          {
            title: '创建交换机 (CreateVSwitch)',
            method: 'POST',
            path: '/api/clouds/:id/resources/vswitches',
            desc: '在指定 VPC 和可用区创建新的交换机。',
            params: JSON.stringify({
              "VpcId": "vpc-bp12345",
              "ZoneId": "cn-hangzhou-b",
              "CidrBlock": "192.168.1.0/24",
              "VSwitchName": "MyVSwitch",
              "Description": "Test VSwitch"
            }, null, 2)
          },
          {
            title: '删除交换机 (DeleteVSwitch)',
            method: 'DELETE',
            path: '/api/clouds/:id/resources/vswitches/:vswitchId',
            desc: '删除指定的交换机。'
          }
        ]
      },
      {
        id: 'aliyun-security-group',
        title: '4. 安全组 (Security Group)',
        endpoints: [
          {
            title: '安全组列表 (封装/默认)',
            method: 'GET',
            path: '/api/clouds/:id/resources/security-groups',
            desc: '【封装模式】默认调用阿里云 DescribeSecurityGroups 接口获取第一页安全组 (PageSize=50)。',
            params: JSON.stringify({}, null, 2)
          },
          {
            title: '安全组列表 (原生/分页)',
            method: 'GET',
            path: '/api/clouds/:id/resources/security-groups',
            desc: '【原生模式】透传调用阿里云 DescribeSecurityGroups 接口。支持 PageNumber 和 PageSize。',
            params: JSON.stringify({
              "PageNumber": 1,
              "PageSize": 10
            }, null, 2)
          },
          {
            title: '创建安全组 (CreateSecurityGroup)',
            method: 'POST',
            path: '/api/clouds/:id/resources/security-groups',
            desc: '创建安全组。',
            params: JSON.stringify({
              "vpcId": "vpc-bp12345", // 必填
              "name": "my-sg", // 必填
              "description": "My Security Group" // 可选
            }, null, 2)
          },
          {
            title: '更新安全组 (ModifySecurityGroupAttribute)',
            method: 'PATCH',
            path: '/api/clouds/:id/resources/security-groups/:sgId',
            desc: '更新安全组属性。',
            params: JSON.stringify({
              "name": "new-name", // 可选
              "description": "new description" // 可选
            }, null, 2)
          },
          {
            title: '删除安全组 (DeleteSecurityGroup)',
            method: 'DELETE',
            path: '/api/clouds/:id/resources/security-groups/:sgId',
            desc: '删除安全组。'
          },
          {
            title: '安全组规则列表 (DescribeSecurityGroupAttribute)',
            method: 'GET',
            path: '/api/clouds/:id/resources/security-groups/:sgId',
            desc: '获取安全组详情及规则列表。'
          },
          {
            title: '添加安全组规则 (AuthorizeSecurityGroup/Egress)',
            method: 'POST',
            path: '/api/clouds/:id/resources/security-groups/:sgId/rules',
            desc: '添加入方向或出方向规则。',
            params: JSON.stringify({
              "direction": "ingress", // ingress 或 egress
              "ipProtocol": "tcp", // tcp, udp, icmp, gre, all
              "portRange": "80/80", // 端口范围，如 "80/80" 或 "-1/-1"
              "cidrIp": "0.0.0.0/0", // 源/目的 CIDR
              "policy": "accept", // accept 或 drop
              "priority": 1, // 优先级 1-100
              "description": "Allow HTTP",
              "nicType": "intranet" // 可选，默认为 intranet
              // 或者使用 sourceGroupId 指定源/目的安全组
            }, null, 2)
          },
          {
            title: '删除安全组规则 (RevokeSecurityGroup/Egress)',
            method: 'DELETE',
            path: '/api/clouds/:id/resources/security-groups/:sgId/rules',
            desc: '删除安全组规则。参数需与创建时一致以定位规则。',
            params: JSON.stringify({
              "direction": "ingress",
              "ipProtocol": "tcp",
              "portRange": "80/80",
              "cidrIp": "0.0.0.0/0",
              "policy": "accept"
            }, null, 2)
          }
        ]
      },
      {
        id: 'aliyun-eni',
        title: '5. 弹性网卡 (ENI)',
        endpoints: [
          {
            title: '弹性网卡列表 (DescribeNetworkInterfaces)',
            method: 'GET',
            path: '/api/clouds/:id/resources/enis',
            desc: '获取弹性网卡列表。支持多种过滤条件。',
            params: JSON.stringify({
              "vpcId": "vpc-bp123", // 可选
              "vSwitchId": "vsw-bp123", // 可选
              "instanceId": "i-bp123" // 可选
            }, null, 2)
          },
          {
            title: '创建弹性网卡 (CreateNetworkInterface)',
            method: 'POST',
            path: '/api/clouds/:id/resources/enis',
            desc: '创建弹性网卡。',
            params: JSON.stringify({
              "vSwitchId": "vsw-bp123", // 必填
              "securityGroupId": "sg-bp123", // 必填
              "name": "my-eni", // 可选
              "description": "My ENI", // 可选
              "ipv4Address": "192.168.1.100" // 可选指定IP
            }, null, 2)
          },
          {
            title: '挂载弹性网卡 (AttachNetworkInterface)',
            method: 'POST',
            path: '/api/clouds/:id/resources/enis/:eniId/attach',
            desc: '将弹性网卡挂载到实例。',
            params: JSON.stringify({
              "instanceId": "i-bp123", // 必填
              "trunkNetworkInstanceId": "i-bp123", // 可选
              "networkCardIndex": 0, // 可选
              "waitForNetworkConfigurationReady": true // 可选
            }, null, 2)
          },
          {
            title: '卸载弹性网卡 (DetachNetworkInterface)',
            method: 'POST',
            path: '/api/clouds/:id/resources/enis/:eniId/detach',
            desc: '从实例卸载弹性网卡。',
            params: JSON.stringify({
              "instanceId": "i-bp123" // 必填
            }, null, 2)
          },
          {
            title: '删除弹性网卡 (DeleteNetworkInterface)',
            method: 'DELETE',
            path: '/api/clouds/:id/resources/enis/:eniId',
            desc: '删除弹性网卡。'
          }
        ]
      },
      {
        id: 'aliyun-acl',
        title: '6. 网络 ACL (Network ACL)',
        endpoints: [
          {
            title: '网络ACL列表 (DescribeNetworkAcls)',
            method: 'GET',
            path: '/api/clouds/:id/resources/network-acls',
            desc: '获取网络ACL列表。',
            params: JSON.stringify({
              "vpcId": "vpc-bp123" // 可选
            }, null, 2)
          },
          {
            title: '创建网络ACL (CreateNetworkAcl)',
            method: 'POST',
            path: '/api/clouds/:id/resources/network-acls',
            desc: '创建网络ACL。',
            params: JSON.stringify({
              "vpcId": "vpc-bp123", // 必填
              "name": "my-acl", // 必填
              "description": "My ACL" // 可选
            }, null, 2)
          },
          {
            title: '删除网络ACL (DeleteNetworkAcl)',
            method: 'DELETE',
            path: '/api/clouds/:id/resources/network-acls/:aclId',
            desc: '删除网络ACL。'
          }
        ]
      },
      {
        id: 'aliyun-eip',
        title: '7. 弹性公网IP (EIP)',
        endpoints: [
          {
            title: '弹性公网IP列表 (DescribeEipAddresses)',
            method: 'GET',
            path: '/api/clouds/:id/resources/eips',
            desc: '获取弹性公网IP列表。'
          },
          {
            title: '绑定EIP (AssociateEipAddress)',
            method: 'POST',
            path: '/api/clouds/:id/resources/eips/:allocationId/associate',
            desc: '绑定EIP到实例或网卡。',
            params: JSON.stringify({
              "InstanceId": "i-bp123", // 绑定到实例
              // 或
              "NetworkInterfaceId": "eni-bp123", // 绑定到网卡
              "PrivateIpAddress": "192.168.1.100" // 绑定到网卡时可选指定私网IP
            }, null, 2)
          },
          {
            title: '解绑EIP (UnassociateEipAddress)',
            method: 'POST',
            path: '/api/clouds/:id/resources/eips/:allocationId/unassociate',
            desc: '解绑EIP。',
            params: JSON.stringify({
              "InstanceId": "i-bp123", // 解绑实例
              // 或
              "NetworkInterfaceId": "eni-bp123" // 解绑网卡
            }, null, 2)
          }
        ]
      },
      {
        id: 'aliyun-route-table',
        title: '8. 路由表 (Route Table)',
        endpoints: [
          {
            title: '路由表列表 (DescribeRouteTableList)',
            method: 'GET',
            path: '/api/clouds/:id/resources/route-tables',
            desc: '获取路由表列表。',
            params: JSON.stringify({
              "vpcId": "vpc-bp123" // 可选
            }, null, 2)
          },
          {
            title: '路由条目查询 (DescribeRouteEntryList)',
            method: 'GET',
            path: '/api/clouds/:id/resources/route-entries',
            desc: '查询指定路由表的路由条目。',
            params: JSON.stringify({
              "routeTableId": "vtb-bp123" // 必填
            }, null, 2)
          },
          {
            title: '创建路由表 (CreateRouteTable)',
            method: 'POST',
            path: '/api/clouds/:id/resources/route-tables',
            desc: '创建自定义路由表。',
            params: JSON.stringify({
              "vpcId": "vpc-bp123", // 必填
              "name": "my-route-table", // 可选
              "description": "My Route Table" // 可选
            }, null, 2)
          },
          {
            title: '删除路由表 (DeleteRouteTable)',
            method: 'DELETE',
            path: '/api/clouds/:id/resources/route-tables/:routeTableId',
            desc: '删除自定义路由表。'
          },
          {
            title: '关联路由表 (AssociateRouteTable)',
            method: 'POST',
            path: '/api/clouds/:id/resources/route-tables/:routeTableId/associate',
            desc: '关联路由表到交换机。',
            params: JSON.stringify({
              "subnetIds": ["vsw-bp1", "vsw-bp2"] // 必填，交换机ID列表
            }, null, 2)
          }
        ]
      },
      {
        id: 'aliyun-slb',
        title: '9. 负载均衡 (SLB)',
        endpoints: [
          {
            title: '负载均衡列表 (DescribeLoadBalancers)',
            method: 'GET',
            path: '/api/clouds/:id/resources/loadbalancers',
            desc: '获取负载均衡实例列表。',
            params: JSON.stringify({}, null, 2)
          }
        ]
      },
      {
        id: 'aliyun-nat',
        title: '10. NAT 网关 (NAT Gateway)',
        endpoints: [
          {
            title: 'NAT网关列表 (DescribeNatGateways)',
            method: 'GET',
            path: '/api/clouds/:id/resources/nat-gateways',
            desc: '获取 NAT 网关列表。',
            params: JSON.stringify({}, null, 2)
          }
        ]
      }
    ]
  },

  'huawei-resources': {
    title: '华为云资源 (Huawei Cloud Resources)',
    desc: '提供华为云专有的资源查询与管理接口，通过云适配器与华为云 API 进行交互。支持返回原生 API 响应结果。',
    sections: [
      {
        id: 'huawei-ecs',
        title: '1. 弹性云服务器 (ECS)',
        endpoints: [
          { 
            title: '实例列表', 
            method: 'GET', 
            path: '/api/clouds/:id/resources/ecs?raw=true', 
            desc: '获取 ECS 实例列表。支持 raw=true 参数返回华为云 ListServersDetails 接口的原生 JSON 响应。',
            extra: (
              <>
                <Paragraph><Text strong>原生响应示例 (raw=true)：</Text></Paragraph>
                <pre style={{ background: '#f5f5f5', padding: 12, borderRadius: 6, fontSize: 12 }}>
{JSON.stringify({
  "count": 1,
  "servers": [
    {
      "id": "e6b9...",
      "name": "ecs-test",
      "status": "ACTIVE",
      "addresses": { "vpc-id": [{ "addr": "192.168.1.1", "version": 4 }] }
    }
  ]
}, null, 2)}
                </pre>
              </>
            )
          }
        ]
      },
      {
        id: 'huawei-vpc',
        title: '2. 虚拟私有云 (VPC)',
        endpoints: [
          { 
            title: 'VPC 列表', 
            method: 'GET', 
            path: '/api/clouds/:id/resources/vpc?raw=true', 
            desc: '获取 VPC 列表。支持 raw=true 参数返回华为云 ListVpcs 接口的原生 JSON 响应。',
            extra: (
              <>
                <Paragraph><Text strong>原生响应示例 (raw=true)：</Text></Paragraph>
                <pre style={{ background: '#f5f5f5', padding: 12, borderRadius: 6, fontSize: 12 }}>
{JSON.stringify({
  "vpcs": [
    {
      "id": "3ec3...",
      "name": "vpc-test",
      "cidr": "192.168.0.0/16",
      "status": "OK"
    }
  ]
}, null, 2)}
                </pre>
              </>
            )
          },
          { title: '子网列表', method: 'GET', path: '/api/clouds/:id/resources/subnet', desc: '获取子网列表。映射华为云 ListSubnets 接口。' }
        ]
      }
    ]
  },

  'cloudmap-resources': {
    title: 'Cloudmap/边缘云 (Private/Edge Cloud)',
    desc: '提供 Cloudmap 私有云及融合边缘云环境的资源查询接口。支持返回 Harvester/Cloudmap 原生响应结果。',
    sections: [
      {
        id: 'cloudmap-vm',
        title: '1. 虚拟机管理',
        endpoints: [
          { 
            title: '虚拟机列表', 
            method: 'GET', 
            path: '/api/clouds/:id/resources/vm?raw=true', 
            desc: '获取虚拟机列表。支持 raw=true 参数返回 Cloudmap/Harvester 原生资源清单接口的完整 JSON 响应。',
            extra: (
              <>
                <Paragraph><Text strong>原生响应示例 (raw=true)：</Text></Paragraph>
                <pre style={{ background: '#f5f5f5', padding: 12, borderRadius: 6, fontSize: 12 }}>
{JSON.stringify([
  {
    "metadata": { "name": "vm-1", "namespace": "default" },
    "spec": { "template": { "spec": { "domain": { "cpu": { "cores": 2 } } } } },
    "status": { "phase": "Running" }
  }
], null, 2)}
                </pre>
              </>
            )
          }
        ]
      },
      {
        id: 'cloudmap-net',
        title: '2. 网络管理',
        endpoints: [
          { title: '网络列表', method: 'GET', path: '/api/clouds/:id/resources/network', desc: '获取网络/子网配置列表。' }
        ]
      }
    ]
  },

  'traffic-orchestration': {
    title: '流量编排 (Traffic Orchestration)',
    desc: '流量编排模块提供基于安全区域和防护对象的精细化流量调度与防护能力。',
    sections: [
      {
        id: 'traffic-protected-objects',
        title: '1. 防护对象管理（CSM 资产）',
        endpoints: [
          { title: '防护对象管理', method: 'GET', path: '/api/v1/traffic-orchestration/protection-objects', desc: '获取防护对象列表。' }
        ]
      },
      {
        id: 'traffic-service-chains',
        title: '2. 服务链管理',
        endpoints: [
           { title: '服务链管理', method: 'GET', path: '/api/v1/traffic-orchestration/service-chains', desc: '获取服务链列表。' }
        ]
      },
      {
        id: 'traffic-policies',
        title: '3. 引流策略管理',
        endpoints: [
           { title: '安全区域管理', method: 'GET', path: '/api/v1/traffic-orchestration/security-zones', desc: '获取安全区域列表（用于策略配置）。' },
           { title: '引流策略管理', method: 'GET', path: '/api/v1/traffic-orchestration/policies', desc: '获取引流策略列表。' }
        ]
      }
    ]
  },
  'tenant-mgmt': {
    title: '租户管理 (Tenant Management)',
    desc: '租户管理模块用于管理多租户架构下的组织结构、资源配额及用户体系。',
    sections: [
      {
        id: 'tenant-lifecycle',
        title: '1. 租户生命周期',
        endpoints: [
          {
            title: '获取租户列表',
            method: 'GET',
            path: '/api/tenants',
            desc: '获取所有租户列表。返回数据按创建时间倒序排列。'
          },
          {
            title: '创建租户',
            method: 'POST',
            path: '/api/tenants',
            desc: '创建新的租户。系统会自动为新租户创建一个默认的根组织。',
            params: JSON.stringify({
              "name": "NewTenant",
              "description": "A new tenant for project X"
            }, null, 2)
          },
          {
            title: '获取租户详情',
            method: 'GET',
            path: '/api/tenants/:id',
            desc: '获取特定租户的详细配置信息，包括根组织ID等元数据。'
          },
          {
            title: '更新租户信息',
            method: 'PUT',
            path: '/api/tenants/:id',
            desc: '更新租户的基本信息（名称、描述、状态）。',
            params: JSON.stringify({
              "name": "UpdatedTenantName",
              "description": "Updated description",
              "status": "active" // 可选: active, inactive
            }, null, 2)
          },
          {
            title: '删除租户',
            method: 'DELETE',
            path: '/api/tenants/:id',
            desc: '删除指定租户。注意：此操作将级联删除该租户下的所有组织、用户及资源分配记录，请谨慎操作。'
          },
          {
            title: '获取租户专线列表',
            method: 'GET',
            path: '/api/tenants/with-leased-lines',
            desc: '获取租户列表及其关联的专线 IP 信息。常用于网络规划和资源概览。'
          },
          {
            title: '获取可分配资源池',
            method: 'GET',
            path: '/api/tenants/available-resource-pools',
            desc: '获取当前系统中所有可分配给租户使用的云资源池列表。'
          }
        ]
      },
      {
        id: 'org-mgmt',
        title: '2. 组织管理',
        endpoints: [
          {
            title: '获取组织架构树',
            method: 'GET',
            path: '/api/tenants/:id/organizations',
            desc: '获取指定租户下的完整组织架构树。'
          },
          {
            title: '创建组织',
            method: 'POST',
            path: '/api/tenants/:id/organizations',
            desc: '在指定租户下创建新的组织单元。',
            params: JSON.stringify({
              "name": "DevTeam",
              "description": "Development Team",
              "parentId": "parent-org-id" // 可选，不填则为根组织（通常已有默认根）
            }, null, 2)
          },
          {
            title: '更新组织信息',
            method: 'PUT',
            path: '/api/tenants/organizations/:orgId',
            desc: '更新组织的名称、描述或调整其在架构树中的位置（父级/顺序）。',
            params: JSON.stringify({
              "name": "R&D Team",
              "orderIndex": 1
            }, null, 2)
          },
          {
            title: '删除组织',
            method: 'DELETE',
            path: '/api/tenants/organizations/:orgId',
            desc: '删除指定组织。若该组织包含子组织、用户或资源分配，将执行级联删除。'
          },
          {
            title: '分配资源池',
            method: 'POST',
            path: '/api/tenants/organizations/:orgId/resource-pools',
            desc: '为组织分配云资源池权限。',
            params: JSON.stringify({
              "resourcePoolIds": ["pool-id-1", "pool-id-2"],
              "permissions": ["read", "use"],
              "namespace": "project-ns" // 仅 Harvester/Private Cloud 需要
            }, null, 2)
          },
          {
            title: '获取资源池分配',
            method: 'GET',
            path: '/api/tenants/organizations/:orgId/resource-pools',
            desc: '获取该组织已分配的资源池列表及权限详情。'
          },
          {
            title: '移除资源池分配',
            method: 'DELETE',
            path: '/api/tenants/organizations/:orgId/resource-pools/:poolId',
            desc: '取消组织对指定资源池的访问权限。'
          },
          {
            title: '获取组织用户',
            method: 'GET',
            path: '/api/tenants/:tenantId/organizations/:orgId/users',
            desc: '获取指定组织下的用户列表。'
          },
          {
            title: '创建组织用户',
            method: 'POST',
            path: '/api/tenants/:tenantId/organizations/:orgId/users',
            desc: '在指定组织下创建新用户。',
            params: JSON.stringify({
              "username": "zhangsan",
              "fullName": "Zhang San",
              "email": "zhangsan@example.com",
              "password": "InitialPassword123",
              "role": "user"
            }, null, 2)
          },
          {
            title: '删除组织用户',
            method: 'DELETE',
            path: '/api/tenants/:tenantId/organizations/:orgId/users/:userId',
            desc: '删除指定组织下的用户。'
          }
        ]
      }
    ]
  },
  'leased-lines': {
    title: '租户专线 (Leased Lines)',
    desc: '租户专线模块用于管理租户的物理专线接入及相关安全报告生成。',
    sections: [
      {
        id: 'line-mgmt',
        title: '1. 专线管理',
        endpoints: [
          { title: '获取专线列表', method: 'GET', path: '/api/v1/leased-lines', desc: '获取所有租户专线记录，支持按关键字过滤。' },
          { 
            title: '录入专线信息', 
            method: 'POST', 
            path: '/api/v1/leased-lines', 
            desc: '录入新的租户专线信息。',
            extra: <Paragraph><Text strong>请求参数：</Text> <Text code>tenantName, operator, ips, province, city</Text></Paragraph>
          },
          { title: '更新专线信息', method: 'PATCH', path: '/api/v1/leased-lines/:id', desc: '更新现有专线信息。' }
        ]
      }
    ]
  },
  'tenant-users': {
    title: '租户用户 (Tenant Users)',
    desc: '租户用户模块提供对租户下属用户的查询与管理。',
    sections: [
      {
        id: 'user-query',
        title: '1. 用户查询',
        endpoints: [
          { title: '获取租户用户列表', method: 'GET', path: '/api/v1/users/tenant-users', desc: '获取所有租户下的用户列表，包含关联的组织和租户信息。' }
        ]
      }
    ]
  },
  'auth': {
    title: '认证 (Authentication)',
    desc: '认证模块提供基于JWT的用户登录与注册功能。',
    sections: [
      {
        id: 'basic-auth',
        title: '1. 基础认证',
        endpoints: [
          { 
            title: '用户登录', 
            method: 'POST', 
            path: '/api/auth/login', 
            desc: '用户凭证验证，成功后返回 JWT Token 及用户信息。',
            extra: <Paragraph><Text strong>请求参数：</Text> <Text code>username, password</Text></Paragraph>
          },
          { title: '用户注册', method: 'POST', path: '/api/auth/register', desc: '注册新用户。' }
        ]
      }
    ]
  },
  'system-users': {
    title: '系统用户 (System Users)',
    desc: '系统用户模块用于管理平台管理员及其他系统级用户。',
    sections: [
      {
        id: 'user-mgmt',
        title: '1. 用户管理',
        endpoints: [
          { title: '获取系统用户列表', method: 'GET', path: '/api/v1/users', desc: '获取平台系统用户列表。' },
          { title: '获取当前用户信息', method: 'GET', path: '/api/v1/users/me', desc: '获取当前登录用户的详细信息及权限。' },
          { title: '创建系统用户', method: 'POST', path: '/api/v1/users', desc: '创建新的系统管理员用户（仅超级管理员可用）。' }
        ]
      }
    ]
  }
};
