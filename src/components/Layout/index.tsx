import { Layout as AntLayout, Menu, Select } from 'antd';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useState } from 'react';
import { DashboardOutlined, ProjectOutlined, TeamOutlined, FormOutlined, SyncOutlined, ImportOutlined, UsergroupAddOutlined, MenuFoldOutlined, MenuUnfoldOutlined, SettingOutlined } from '@ant-design/icons';
import { ACTOR_OPTIONS, useActor } from '@/contexts/ActorContext';

const { Sider, Content } = AntLayout;

function getMenuItems(role: string) {
  if (role === '管理员') return [
    { key: '/overview', icon: <DashboardOutlined />, label: '全局总览' },
    { key: '/tasks/register', icon: <ProjectOutlined />, label: '任务全景' },
    { key: '/management-ledger', icon: <FormOutlined />, label: '审核中心' },
    { key: '/personal-work', icon: <TeamOutlined />, label: '人员明细' },
    { key: '/ledger-import', icon: <ImportOutlined />, label: '数据导入' },
    { key: 'settings', icon: <SettingOutlined />, label: '组织与配置', children: [{ key: '/members', label: '成员与小组' }, { key: '/task-relations', label: '任务关系' }, { key: '/system-monitor', label: '系统设置' }] },
  ];
  if (role === '组长') return [
    { key: '/overview', icon: <DashboardOutlined />, label: '本组工作台' },
    { key: '/tasks/register', icon: <ProjectOutlined />, label: '本组任务' },
    { key: '/management-ledger', icon: <FormOutlined />, label: '审核中心' },
    { key: '/members', icon: <UsergroupAddOutlined />, label: '本组人员' },
    { key: '/ledger-import', icon: <ImportOutlined />, label: '导入中心' },
  ];
  return [
    { key: '/overview', icon: <DashboardOutlined />, label: '我的工作台' },
    { key: '/tasks/register', icon: <ProjectOutlined />, label: '我的任务' },
    { key: '/personal-work', icon: <FormOutlined />, label: '工作记录' },
    { key: '/my-deliverables', icon: <SyncOutlined />, label: '我的交付物' },
  ];
}

export default function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const { actor, setActor } = useActor();
  const menuItems = getMenuItems(actor.role);

  return (
    <AntLayout className="app-shell">
      <Sider width={200} collapsedWidth={72} collapsible collapsed={collapsed} trigger={null} theme="dark" className="app-sider">
        <button className="nav-collapse-trigger" onClick={() => setCollapsed(value => !value)} aria-label={collapsed ? '展开导航' : '收起导航'}>
          {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
        </button>
        <div className={`brand ${collapsed ? 'is-collapsed' : ''}`}><span className="brand-mark">一</span>{!collapsed && <span>筝一工作台</span>}</div>
        <Menu
          mode="inline"
          inlineCollapsed={collapsed}
          selectedKeys={[location.pathname]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
          style={{ borderRight: 0 }}
        />
      </Sider>
      <AntLayout>
        <Content className="app-content">
          <div className="actor-bar"><span>当前登录身份</span><Select size="small" value={actor.role} onChange={value => { const selected = ACTOR_OPTIONS.find(option => option.role === value); if (selected) setActor(selected); }} options={ACTOR_OPTIONS.map(option => ({ value: option.role, label: option.role }))} /></div>
          <div className="page-frame"><Outlet /></div>
        </Content>
      </AntLayout>
    </AntLayout>
  );
}
