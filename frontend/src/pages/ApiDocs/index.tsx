import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Layout, Menu, Typography, Divider, Space, Tag, Drawer, Button, Grid, Tree } from 'antd';
import {
  CloudOutlined,
  DesktopOutlined,
  TeamOutlined,
  SafetyCertificateOutlined,
  ApiOutlined,
  GlobalOutlined,
  SettingOutlined,
  DashboardOutlined,
  FolderOutlined,
  FileTextOutlined,
  MenuUnfoldOutlined
} from '@ant-design/icons';
import { docData, PageData, Section, Endpoint } from './data';
import { MethodBadge } from './MethodBadge';

const { Sider, Content } = Layout;
const { Title, Paragraph, Text } = Typography;
const { useBreakpoint } = Grid;

const ApiDocs: React.FC = () => {
  const [selectedKey, setSelectedKey] = useState('cloud-resources');
  const [drawerVisible, setDrawerVisible] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const screens = useBreakpoint();

  const menuItems = [
    {
      key: 'multicloud',
      label: '多云管理',
      icon: <CloudOutlined />,
      children: [
        { key: 'cloud-resources', label: '云资源', icon: <DesktopOutlined /> },
      ]
    },
    {
      key: 'sdn',
      label: 'SDN管理',
      icon: <GlobalOutlined />,
      children: [
        { key: 'security-mgmt', label: '安全管理面', icon: <SafetyCertificateOutlined /> },
        { key: 'cross-region', label: '跨地域互联', icon: <GlobalOutlined /> },
        { key: 'traffic-orchestration', label: '流量编排', icon: <ApiOutlined /> },
      ]
    },
    {
      key: 'tenants',
      label: '租户管理',
      icon: <TeamOutlined />,
      children: [
        { key: 'tenant-mgmt', label: '租户管理', icon: <TeamOutlined /> },
        { key: 'leased-lines', label: '租户专线', icon: <ApiOutlined /> },
        { key: 'tenant-users', label: '租户用户', icon: <TeamOutlined /> },
      ]
    },
    {
      key: 'permissions',
      label: '权限管控',
      icon: <SafetyCertificateOutlined />,
      children: [
        { key: 'auth', label: '认证', icon: <SafetyCertificateOutlined /> },
        { key: 'system-users', label: '系统用户', icon: <TeamOutlined /> },
      ]
    },
    {
      key: 'system-mgmt',
      label: '系统管理',
      icon: <SettingOutlined />,
      children: [
        { key: 'dashboard', label: '仪表盘', icon: <DashboardOutlined /> },
        { key: 'system-settings', label: '系统设置', icon: <SettingOutlined /> },
      ]
    },
  ];

  const currentDoc = docData[selectedKey];

  const tocContent = currentDoc ? (
    <div style={{ padding: '24px 16px' }}>
      <Title level={5} style={{ marginBottom: 16, paddingLeft: 8 }}>目录 (Table of Contents)</Title>
      <TocTree 
        sections={currentDoc.sections} 
        containerRef={scrollContainerRef}
        onSelect={() => setDrawerVisible(false)}
      />
    </div>
  ) : null;

  return (
    <Layout style={{ height: '100%', background: '#fff', position: 'relative' }}>
      <Sider 
        width={260} 
        theme="light" 
        breakpoint="lg"
        collapsedWidth="0"
        style={{ 
          borderRight: '1px solid #f0f0f0',
          height: '100%',
          overflow: 'auto',
          zIndex: 10
        }}
      >
        <div style={{ padding: '16px 24px', borderBottom: '1px solid #f0f0f0' }}>
          <Space>
            <ApiOutlined style={{ fontSize: 20, color: '#1890ff' }} />
            <Text strong style={{ fontSize: 16 }}>API Documentation</Text>
          </Space>
        </div>
        <Menu
          mode="inline"
          defaultOpenKeys={['multicloud', 'sdn', 'tenants', 'permissions', 'system-mgmt']}
          selectedKeys={[selectedKey]}
          items={menuItems}
          onClick={({ key }) => setSelectedKey(key)}
          style={{ borderRight: 0 }}
        />
      </Sider>
      
      <Layout style={{ background: '#fff', position: 'relative' }}>
        <Content
          style={{
            padding: '24px 48px',
            margin: 0,
            height: '100%',
            overflowY: 'auto',
            scrollBehavior: 'smooth'
          }}
          ref={scrollContainerRef}
          id="doc-scroll-container"
        >
          {currentDoc ? (
            <DocRenderer data={currentDoc} />
          ) : (
            <div style={{ padding: 24, textAlign: 'center' }}>
              <Text type="secondary">该模块文档暂未更新</Text>
            </div>
          )}
        </Content>

        {/* Desktop TOC Sider */}
        {currentDoc && (
          <Sider
            width={300}
            theme="light"
            breakpoint="lg"
            collapsedWidth="0"
            trigger={null}
            style={{
              borderLeft: '1px solid #f0f0f0',
              height: '100%',
              background: '#fafafa'
            }}
          >
            {tocContent}
          </Sider>
        )}

        {/* Mobile TOC Button and Drawer */}
        {!screens.lg && currentDoc && (
          <>
            <Button
              type="primary"
              shape="circle"
              icon={<MenuUnfoldOutlined />}
              size="large"
              style={{
                position: 'absolute',
                bottom: 24,
                right: 24,
                zIndex: 100,
                boxShadow: '0 2px 8px rgba(0,0,0,0.15)'
              }}
              onClick={() => setDrawerVisible(true)}
            />
            <Drawer
              placement="bottom"
              height="60%"
              onClose={() => setDrawerVisible(false)}
              open={drawerVisible}
              title="目录"
              bodyStyle={{ padding: 0 }}
            >
              {tocContent}
            </Drawer>
          </>
        )}
      </Layout>
    </Layout>
  );
};

// --- Helper Components ---

const TocTree: React.FC<{
  sections: Section[];
  containerRef: React.RefObject<HTMLDivElement>;
  onSelect?: () => void;
}> = ({ sections, containerRef, onSelect }) => {
  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([]);
  const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([]);
  const [autoExpandParent, setAutoExpandParent] = useState(true);

  // Map section structure to TreeData
  const mapToTreeData = (list: Section[]): any[] => {
    return list.map(item => ({
      key: item.id,
      title: item.title,
      icon: item.children && item.children.length > 0 ? <FolderOutlined /> : <FileTextOutlined />,
      children: item.children ? mapToTreeData(item.children) : undefined
    }));
  };

  const treeData = useMemo(() => mapToTreeData(sections), [sections]);

  // Build a map of id -> parentId for auto-expansion
  const parentMap = useMemo(() => {
    const map = new Map<string, string>();
    const traverse = (list: Section[], parentId?: string) => {
      list.forEach(item => {
        if (parentId) map.set(item.id, parentId);
        if (item.children) traverse(item.children, item.id);
      });
    };
    traverse(sections);
    return map;
  }, [sections]);

  // Get all IDs for scroll spy
  const allIds = useMemo(() => {
    const ids: string[] = [];
    const traverse = (list: Section[]) => {
      list.forEach(item => {
        ids.push(item.id);
        if (item.children) traverse(item.children);
      });
    };
    traverse(sections);
    return ids;
  }, [sections]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let ticking = false;

    const handleScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          // Find the active section
          // We look for the first section that is visible or close to the top
          const offset = 100; // Offset for header/padding
          const containerTop = container.getBoundingClientRect().top;
          
          let currentId = '';
          
          for (const id of allIds) {
            const element = document.getElementById(id);
            if (element) {
              const rect = element.getBoundingClientRect();
              // If the element is near the top (e.g., within offset)
              if (rect.top <= containerTop + offset) {
                currentId = id;
              } else {
                // Since ids are roughly in order, if we find one below, we can stop?
                // Not necessarily true if nested, but in DOM order it is true.
                // DOM order matches traversal order usually.
                // But let's check all to be safe or optimize later.
                // Actually, finding the *last* one that satisfies `rect.top <= containerTop + offset` is correct.
              }
            }
          }

          if (currentId) {
            setSelectedKeys([currentId]);
            
            // Auto expand parents
            if (autoExpandParent) {
              const parents: string[] = [];
              let curr: string | undefined = currentId;
              while ((curr = parentMap.get(curr!))) {
                parents.push(curr);
              }
              // We merge with existing expanded keys to avoid collapsing others?
              // Or we strictly enforce path? 
              // Usually we just ensure parents are expanded.
              setExpandedKeys(prev => {
                const newKeys = new Set([...prev, ...parents]);
                return Array.from(newKeys);
              });
            }
          }
          
          ticking = false;
        });
        ticking = true;
      }
    };

    container.addEventListener('scroll', handleScroll);
    handleScroll(); // Initial check

    return () => container.removeEventListener('scroll', handleScroll);
  }, [allIds, parentMap, containerRef, autoExpandParent]);

  const onExpand = (newExpandedKeys: React.Key[]) => {
    setExpandedKeys(newExpandedKeys);
    setAutoExpandParent(false); // Disable auto expand if user manually interacts
  };

  const handleSelect = (keys: React.Key[]) => {
    if (keys.length > 0) {
      const id = keys[0] as string;
      const element = document.getElementById(id);
      if (element) {
        // Adjust scroll position to account for padding
        // element.scrollIntoView({ behavior: 'smooth' }); 
        // scrollIntoView aligns to top, which might be behind headers? 
        // Our layout has no fixed header inside Content, so it's fine.
        // But we are scrolling the container.
        
        const container = containerRef.current;
        if (container) {
          const containerTop = container.getBoundingClientRect().top;
          const elementTop = element.getBoundingClientRect().top;
          const relativeTop = elementTop - containerTop + container.scrollTop;
          
          container.scrollTo({
            top: relativeTop - 24, // 24px padding
            behavior: 'smooth'
          });
        }
        
        setSelectedKeys([id]);
        onSelect?.();
      }
    }
  };

  return (
    <Tree
      showIcon
      blockNode
      treeData={treeData}
      selectedKeys={selectedKeys}
      expandedKeys={expandedKeys}
      autoExpandParent={autoExpandParent}
      onExpand={onExpand}
      onSelect={handleSelect}
      style={{ background: 'transparent' }}
    />
  );
};

const DocRenderer: React.FC<{ data: PageData }> = ({ data }) => {
  const renderSection = (section: Section, level: 3 | 4 | 5 = 3) => (
    <div key={section.id} id={section.id} style={{ marginBottom: level === 3 ? 48 : 24 }}>
      <Title level={level}>{section.title}</Title>
      {section.intro && <div style={{ marginBottom: 16 }}>{section.intro}</div>}
      
      {section.endpoints && (
        <Space direction="vertical" style={{ width: '100%' }}>
          {section.endpoints.map((ep, idx) => (
            <EndpointCard key={idx} endpoint={ep} />
          ))}
        </Space>
      )}

      {section.children && (
        <div style={{ marginLeft: 24, marginTop: 24 }}>
          {section.children.map(child => renderSection(child, Math.min(level + 1, 5) as 3 | 4 | 5))}
        </div>
      )}
    </div>
  );

  return (
    <Typography>
      <Title level={2}>{data.title}</Title>
      <Paragraph>{data.desc}</Paragraph>
      <Divider />
      
      {data.sections.map(section => renderSection(section))}
    </Typography>
  );
};

const EndpointCard: React.FC<{ endpoint: Endpoint }> = ({ endpoint }) => {
  return (
    <div style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: 16, marginBottom: 16 }}>
      <Text strong style={{ fontSize: 16, display: 'block', marginBottom: 12 }}>{endpoint.title}</Text>
      
      {endpoint.method && endpoint.path && (
        <Paragraph>
          <MethodBadge method={endpoint.method} />
          <Text code>{endpoint.path}</Text>
        </Paragraph>
      )}
      
      <Paragraph>
        {endpoint.desc}
      </Paragraph>
      
      {endpoint.params && (
        <Paragraph>
          <Text strong>请求参数示例：</Text>
          <pre style={{ background: '#f5f5f5', padding: 12, borderRadius: 6, fontSize: 12, overflow: 'auto' }}>
            {endpoint.params}
          </pre>
        </Paragraph>
      )}
      
      {endpoint.extra}
    </div>
  );
};

export default ApiDocs;
