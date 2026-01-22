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
    title: '云资源 (Cloud Resources)',
    desc: '云资源模块提供对多云环境下的云主机、网络、存储等基础设施资源的统一接入与管理能力。',
    sections: [
      {
        id: 'cloud-access',
        title: '1. 云资源接入',
        children: [
          {
            id: 'cloud-access-list',
            title: '1.1 获取列表',
            endpoints: [
              {
                title: '获取云资源列表',
                method: 'GET',
                path: '/api/v1/clouds',
                desc: '获取已接入的云资源账户列表（敏感信息已脱敏）。'
              }
            ]
          },
          {
            id: 'cloud-access-add',
            title: '1.2 接入资源',
            endpoints: [
              {
                title: '接入新云资源',
                method: 'POST',
                path: '/api/v1/clouds',
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
          }
        ]
      },
      {
        id: 'resource-ops',
        title: '2. 资源操作',
        endpoints: [
           {
            title: '云资源操作',
            desc: (
              <>
                <Paragraph>
                  <MethodBadge method="PUT" /> <Text code>/api/v1/clouds/:id</Text> <span style={{ marginLeft: 8 }}>更新云资源配置</span>
                </Paragraph>
                <Divider style={{ margin: '8px 0' }} />
                <Paragraph>
                  <MethodBadge method="DELETE" /> <Text code>/api/v1/clouds/:id</Text> <span style={{ marginLeft: 8 }}>移除云资源</span>
                </Paragraph>
                <Divider style={{ margin: '8px 0' }} />
                <Paragraph>
                  <MethodBadge method="POST" /> <Text code>/api/v1/clouds/:id/test</Text> <span style={{ marginLeft: 8 }}>测试连接状态</span>
                </Paragraph>
              </>
            )
          }
        ]
      },
      {
        id: 'unified-view',
        title: '3. 统一资源视图',
        endpoints: [
          {
            title: '获取所有云主机',
            method: 'GET',
            path: '/api/v1/clouds/resources/ecs-all',
            desc: '获取所有已接入云资源池中的云主机实例（聚合视图）。'
          }
        ]
      },
      {
        id: 'native-proxy',
        title: '4. 原生资源代理',
        intro: (
          <>
            <Paragraph>平台提供透传代理接口，直接调用云厂商 API 获取资源详情。</Paragraph>
            <Paragraph><Text strong>URL 模式：</Text> <Text code>/api/v1/clouds/:id/resources/:resourceType</Text></Paragraph>
            <Paragraph>
              <Text strong>支持的资源类型 (resourceType)：</Text>
              <ul>
                <li><Text code>ecs</Text> - 云服务器实例</li>
                <li><Text code>vpcs</Text> - 专有网络 (VPC)</li>
                <li><Text code>vswitches</Text> - 交换机/子网</li>
                <li><Text code>security-groups</Text> - 安全组</li>
                <li><Text code>disks</Text> - 云磁盘</li>
                <li><Text code>snapshots</Text> - 快照</li>
              </ul>
            </Paragraph>
          </>
        ),
        endpoints: []
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
            path: '/api/v1/security-domains',
            desc: '获取所有安全域配置。'
          },
          {
            title: '获取安全域详情',
            method: 'GET',
            path: '/api/v1/security-domains/:id',
            desc: '获取安全域详情，包含关联的云实例、服务链及应用实例信息。'
          }
        ]
      },
      {
        id: 'cascade-channels',
        title: '2. 级联通道管理',
        endpoints: [
          { title: '获取级联通道列表', method: 'GET', path: '/api/v1/cens', desc: '获取所有级联通道(CEN)实例。' },
          { title: '创建级联通道', method: 'POST', path: '/api/v1/cens', desc: '创建新的级联通道。' },
          { title: '挂载网络实例', method: 'POST', path: '/api/v1/cens/:id/attachments', desc: '将VPC或安全域挂载到级联通道。' }
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
          id: 'smp-apps',
          title: '2. SASE网关 (SASE Gateways)',
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
        title: '3. SRv6隧道管理',
        endpoints: [
          { title: '获取隧道列表', method: 'GET', path: '/api/v1/srv6', desc: '获取所有 SRv6 隧道配置。' },
          { title: '创建隧道', method: 'POST', path: '/api/v1/srv6', desc: '创建新的 SRv6 隧道 (PE-PE / CE-CE)。' }
        ]
      },
      {
        id: 'interconnect-ipsec',
        title: '4. IPsecVPN管理',
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
        title: '5. ACL 访问控制列表',
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
        title: '6. NAT 网络地址转换',
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
