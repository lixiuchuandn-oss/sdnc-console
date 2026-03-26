/**
 * ==============================================================================
 * 模块名称: 镜像仓库浏览器组件 (RegistryBrowser)
 * 文件路径: src/pages/Clouds/Harvester/containers/components/RegistryBrowser.tsx
 * ==============================================================================
 * 
 * [功能描述]
 * 浏览已配置凭证的镜像仓库，展示层级结构：
 * - 仓库目录 (Catalog)
 * - 镜像名称
 * - 标签列表
 * 
 * [核心功能]
 * 1. 异步加载：点击时才加载子节点数据
 * 2. 搜索过滤：支持按名称搜索镜像
 * 3. 镜像选择：点击标签选择镜像，返回格式 server/repository:tag
 * 4. 复制地址：点击标签复制镜像完整地址
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Tree, Input, Empty, Spin, Typography, Tag, message, Space, Tooltip, Popconfirm, Dropdown, Button } from 'antd';
import { 
  DockerOutlined, 
  TagOutlined, 
  SearchOutlined,
  ReloadOutlined,
  LinkOutlined,
  CopyOutlined,
  DeleteOutlined,
  MoreOutlined,
} from '@ant-design/icons';
import type { TreeDataNode, TreeProps, MenuProps } from 'antd';
import { getRegistryCatalog, getRegistryTags } from '../../../../../services/harvesterApi';

const { Text } = Typography;

/**
 * 凭证信息接口
 */
export interface RegistryCredential {
  name?: string;          // Secret 名称 (可选)
  namespace?: string;     // Secret 命名空间 (可选)
  server: string;         // 仓库地址
  username?: string;      // 用户名 (可选)
  password?: string;      // 密码 (可选)
  insecure?: boolean;     // 是否使用 HTTP (可选)
}

/**
 * 组件属性接口
 */
export interface RegistryBrowserProps {
  cloudId: string;
  credential: RegistryCredential;
  onSelectImage?: (image: string) => void;  // 选择镜像回调
  style?: React.CSSProperties;
  className?: string;
  /** 当前选中的镜像地址（用于高亮显示） */
  currentImage?: string;
}

/**
 * 树节点类型
 */
type NodeType = 'root' | 'repository' | 'tag';

/**
 * 扩展的树节点数据
 */
interface ExtendedTreeDataNode extends TreeDataNode {
  nodeType: NodeType;
  server?: string;
  repository?: string;
  tag?: string;
  isLeaf?: boolean;
}

/**
 * 解析服务器地址，提取主机名
 */
const parseServerHost = (server: string): string => {
  try {
    const url = new URL(server);
    return url.host;
  } catch {
    // 如果不是有效 URL，直接返回原值
    return server.replace(/^https?:\/\//, '').replace(/\/$/, '');
  }
};

/**
 * RegistryBrowser 组件
 */
const RegistryBrowser: React.FC<RegistryBrowserProps> = ({
  cloudId,
  credential,
  onSelectImage,
  style,
  className,
  currentImage,
}) => {
  const [treeData, setTreeData] = useState<ExtendedTreeDataNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([]);
  const [loadedKeys, setLoadedKeys] = useState<Set<string>>(new Set());
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [treeKey, setTreeKey] = useState(0); // 用于强制重新渲染 Tree 组件

  // 是否为选择模式
  const isSelectMode = !!onSelectImage;

  // 解析 currentImage，提取仓库和标签信息
  const currentImageInfo = useMemo(() => {
    if (!currentImage || !currentImage.startsWith(credential.server)) {
      return null;
    }

    // 移除服务器地址，得到 repository:tag
    const remainder = currentImage.substring(credential.server.length + 1);
    const colonIndex = remainder.lastIndexOf(':');

    if (colonIndex === -1) {
      return { repository: remainder, tag: 'latest' };
    }

    return {
      repository: remainder.substring(0, colonIndex),
      tag: remainder.substring(colonIndex + 1),
    };
  }, [currentImage, credential.server]);

  /**
   * 加载仓库目录
   */
  const loadCatalog = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getRegistryCatalog(
        cloudId,
        credential.server,
        credential.username,
        credential.password,
        credential.insecure ?? true,
      );
      
      if (result?.data?.repositories) {
        const repositories: string[] = result.data.repositories;
        
        const nodes: ExtendedTreeDataNode[] = repositories.map((repo) => ({
          key: `repo:${repo}`,
          title: <Text>{repo}</Text>,
          icon: <DockerOutlined style={{ color: '#1890ff' }} />,
          nodeType: 'repository' as NodeType,
          server: credential.server,
          repository: repo,
          isLeaf: false,
          children: [],
        }));
        
        nodes.sort((a, b) => {
          const aRepo = a.repository || '';
          const bRepo = b.repository || '';
          return aRepo.localeCompare(bRepo);
        });
        
        setTreeData(nodes);
        setInitialLoaded(true);
      } else {
        setTreeData([]);
        setInitialLoaded(true);
      }
    } catch (error: any) {
      console.error('加载仓库目录失败:', error);
      message.error(error?.message || '加载仓库目录失败');
      setTreeData([]);
      setInitialLoaded(true);
    } finally {
      setLoading(false);
    }
  }, [cloudId, credential]);

  /**
   * 加载镜像标签
   */
  const loadTags = useCallback(async (repository: string): Promise<ExtendedTreeDataNode[]> => {
    try {
      const result = await getRegistryTags(
        cloudId,
        credential.server,
        repository,
        credential.username,
        credential.password,
        credential.insecure ?? true,
      );
      
      if (result?.data?.tags) {
        const tags: string[] = result.data.tags;
        
        const tagNodes: ExtendedTreeDataNode[] = tags.map((tag) => ({
          key: `tag:${repository}:${tag}`,
          title: <Text>{tag}</Text>,
          icon: <TagOutlined style={{ color: '#52c41a' }} />,
          nodeType: 'tag' as NodeType,
          server: credential.server,
          repository,
          tag,
          isLeaf: true,
        }));
        
        tagNodes.sort((a, b) => {
          const aTag = a.tag || '';
          const bTag = b.tag || '';
          if (aTag === 'latest') return -1;
          if (bTag === 'latest') return 1;
          return aTag.localeCompare(bTag);
        });
        
        return tagNodes;
      }
      
      return [];
    } catch (error: any) {
      console.error(`加载镜像 ${repository} 标签失败:`, error);
      return [];
    }
  }, [cloudId, credential]);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  // 当 currentImage 变化时，自动展开对应的节点并高亮标签
  useEffect(() => {
    console.log('[RegistryBrowser] currentImage changed:', currentImage);
    console.log('[RegistryBrowser] currentImageInfo:', currentImageInfo);
    console.log('[RegistryBrowser] initialLoaded:', initialLoaded);
    console.log('[RegistryBrowser] loadedKeys:', Array.from(loadedKeys));
    console.log('[RegistryBrowser] current treeData:', treeData);
    
    if (currentImageInfo && initialLoaded) {
      const repoKey = `repo:${currentImageInfo.repository}`;
      const tagKey = `tag:${currentImageInfo.repository}:${currentImageInfo.tag}`;

      console.log('[RegistryBrowser] repoKey:', repoKey, 'tagKey:', tagKey);

      // 检查仓库节点是否存在
      const repoNode = treeData.find(node => node.key === repoKey);
      console.log('[RegistryBrowser] Found repo node:', repoNode);
      
      // 如果仓库节点不存在，等待加载
      if (!repoNode) {
        console.log('[RegistryBrowser] Repo node not found, waiting for load');
        return;
      }

      // 如果仓库节点存在但没有 children，或者 loadedKeys 不包含该节点，重新加载
      const needReload = !loadedKeys.has(repoKey) || !repoNode.children || repoNode.children.length === 0;
      console.log('[RegistryBrowser] Need reload:', needReload, 'loadedKeys.has:', loadedKeys.has(repoKey), 'has children:', !!(repoNode.children && repoNode.children.length > 0));

      if (needReload) {
        console.log('[RegistryBrowser] Loading tags for repository:', currentImageInfo.repository);
        loadTags(currentImageInfo.repository).then((tagNodes) => {
          console.log('[RegistryBrowser] Tags loaded:', tagNodes.length, 'tags');
          setTreeData((prevData) => {
            const updateNode = (nodes: ExtendedTreeDataNode[]): ExtendedTreeDataNode[] => {
              return nodes.map((n) => {
                if (n.key === repoKey) {
                  console.log('[RegistryBrowser] Updating node with children:', n.key, tagNodes.length);
                  return { ...n, children: tagNodes };
                }
                if (n.children) {
                  return { ...n, children: updateNode(n.children as ExtendedTreeDataNode[]) };
                }
                return n;
              });
            };
            const newData = updateNode(prevData);
            console.log('[RegistryBrowser] New treeData:', newData);
            return newData;
          });
          setLoadedKeys((prev) => new Set(prev).add(repoKey));
          setTreeKey(prev => prev + 1); // 强制重新渲染 Tree
          
          // 加载标签后，设置展开和高亮
          setExpandedKeys((prev) => [...prev, repoKey]);
          setSelectedTag(tagKey);
        });
      } else {
        console.log('[RegistryBrowser] Repository already loaded with children, just expanding and selecting');
        console.log('[RegistryBrowser] Repo node children:', repoNode.children);
        // 仓库已经加载，直接展开和高亮
        setExpandedKeys((prev) => {
          if (!prev.includes(repoKey)) {
            const newKeys = [...prev, repoKey];
            console.log('[RegistryBrowser] Expanding keys:', newKeys);
            return newKeys;
          }
          return prev;
        });

        console.log('[RegistryBrowser] Setting selected tag:', tagKey);
        setSelectedTag(tagKey);
        setTreeKey(prev => prev + 1); // 强制重新渲染 Tree
      }
    }
  }, [currentImageInfo, initialLoaded, loadedKeys, loadTags, treeData]);

  const onLoadData: TreeProps['loadData'] = async (treeNode) => {
    const node = treeNode as unknown as ExtendedTreeDataNode;
    const key = String(node.key);
    
    if (loadedKeys.has(key) && node.children && node.children.length > 0) {
      console.log('[RegistryBrowser] Node already loaded with children:', key);
      return;
    }
    
    if (node.nodeType === 'repository' && node.repository) {
      console.log('[RegistryBrowser] Loading tags for node:', key);
      const tagNodes = await loadTags(node.repository);
      
      console.log('[RegistryBrowser] Loaded', tagNodes.length, 'tags for:', key);
      setTreeData((prevData) => {
        const updateNode = (nodes: ExtendedTreeDataNode[]): ExtendedTreeDataNode[] => {
          return nodes.map((n) => {
            if (n.key === key) {
              console.log('[RegistryBrowser] Updating node:', key, 'with', tagNodes.length, 'children');
              return { ...n, children: tagNodes };
            }
            if (n.children) {
              return { ...n, children: updateNode(n.children as ExtendedTreeDataNode[]) };
            }
            return n;
          });
        };
        const newData = updateNode(prevData);
        console.log('[RegistryBrowser] TreeData after update:', newData);
        return newData;
      });
      
      setLoadedKeys((prev) => new Set(prev).add(key));
      setTreeKey(prev => prev + 1); // 强制重新渲染
    }
  };

  /**
   * 复制镜像地址
   */
  const handleCopyImage = useCallback((server: string, repository: string, tag: string) => {
    const imageRef = `${server}/${repository}:${tag}`;
    navigator.clipboard.writeText(imageRef);
    message.success('已复制镜像地址');
  }, []);

  /**
   * 选择节点
   */
  const handleSelect: TreeProps['onSelect'] = (selectedKeys, info) => {
    const node = info.node as unknown as ExtendedTreeDataNode;
    
    if (node.nodeType === 'tag' && node.repository && node.tag) {
      const imageRef = `${credential.server}/${node.repository}:${node.tag}`;
      
      setSelectedTag(String(node.key));
      
      if (onSelectImage) {
        onSelectImage(imageRef);
      }
    }
  };

  const filteredTreeData = useMemo(() => {
    if (!searchValue.trim()) {
      return treeData;
    }
    
    const keyword = searchValue.trim().toLowerCase();
    
    const filterNodes = (nodes: ExtendedTreeDataNode[]): ExtendedTreeDataNode[] => {
      return nodes.reduce<ExtendedTreeDataNode[]>((acc, node) => {
        const repo = node.repository || '';
        const tag = node.tag || '';
        const matchesSearch = repo.toLowerCase().includes(keyword) || tag.toLowerCase().includes(keyword);
        
        if (matchesSearch) {
          acc.push(node);
        } else if (node.children && node.children.length > 0) {
          const filteredChildren = filterNodes(node.children as ExtendedTreeDataNode[]);
          if (filteredChildren.length > 0) {
            acc.push({ ...node, children: filteredChildren });
          }
        }
        
        return acc;
      }, []);
    };
    
    return filterNodes(treeData);
  }, [treeData, searchValue]);

  const handleRefresh = () => {
    setLoadedKeys(new Set());
    setExpandedKeys([]);
    setSelectedTag(null);
    loadCatalog();
  };

  // 渲染空状态
  if (!initialLoaded && loading) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 0', ...style }} className={className}>
        <Spin tip="正在加载仓库目录..." />
      </div>
    );
  }

  return (
    <div style={style} className={className}>
      {/* 仓库地址标题 */}
      <div style={{ 
        marginBottom: 12, 
        padding: '8px 12px', 
        background: '#fafafa', 
        borderRadius: 4,
        border: '1px solid #f0f0f0',
      }}>
        <Space>
          <LinkOutlined style={{ color: '#1890ff' }} />
          <Text strong>仓库地址：</Text>
          <Text code copyable>{credential.server}</Text>
        </Space>
      </div>
      
      {/* 搜索和刷新工具栏 */}
      <div style={{ marginBottom: 12, display: 'flex', gap: 8 }}>
        <Input
          placeholder="搜索镜像名称或标签..."
          prefix={<SearchOutlined style={{ color: '#bfbfbf' }} />}
          value={searchValue}
          onChange={(e) => setSearchValue(e.target.value)}
          allowClear
          style={{ flex: 1 }}
        />
        <a onClick={handleRefresh} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <ReloadOutlined spin={loading} />
          刷新
        </a>
      </div>
      
      {/* 树形结构 */}
      {filteredTreeData.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={searchValue ? '未找到匹配的镜像' : '仓库为空'}
          style={{ margin: '20px 0' }}
        />
      ) : (
        <Tree
          key={treeKey}
          showIcon
          blockNode
          expandedKeys={expandedKeys}
          onExpand={setExpandedKeys}
          loadedKeys={Array.from(loadedKeys)}
          loadData={onLoadData}
          treeData={filteredTreeData}
          onSelect={handleSelect}
          selectedKeys={selectedTag ? [selectedTag] : []}
          style={{ marginTop: 8 }}
          expandAction="click"
          titleRender={(node) => {
            const extNode = node as ExtendedTreeDataNode;
            
            // 标签节点：显示复制按钮和选择状态
            if (extNode.nodeType === 'tag' && extNode.repository && extNode.tag) {
              return (
                <div 
                  style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'space-between',
                    width: '100%',
                    paddingRight: 8,
                  }}
                >
                  <span>{node.title as React.ReactNode}</span>
                  <Space size={4}>
                    {/* 选择模式下显示"已选择"标签 */}
                    {isSelectMode && selectedTag === node.key && (
                      <Tag color="green" style={{ marginLeft: 8 }}>已选择</Tag>
                    )}
                    {/* 复制按钮 */}
                    <Tooltip title="复制镜像地址">
                      <Button
                        type="text"
                        size="small"
                        icon={<CopyOutlined />}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCopyImage(credential.server, extNode.repository!, extNode.tag!);
                        }}
                      />
                    </Tooltip>
                  </Space>
                </div>
              );
            }
            
            return node.title as React.ReactNode;
          }}
        />
      )}
      
      {/* 提示信息 */}
      <div style={{ marginTop: 12, color: '#8c8c8c', fontSize: 12 }}>
        <Text type="secondary">
          {isSelectMode 
            ? '点击镜像名称展开标签列表，点击标签选择镜像'
            : '点击镜像名称展开标签列表，点击复制图标复制镜像地址'
          }
        </Text>
      </div>
    </div>
  );
};

export default RegistryBrowser;