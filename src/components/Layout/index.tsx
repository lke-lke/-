import { Layout as AntLayout, Menu } from 'antd';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useState } from 'react';
import {
  DashboardOutlined,
  ProjectOutlined,
  TeamOutlined,
  FormOutlined,
  SyncOutlined,
  MonitorOutlined,
  ImportOutlined,
  CalendarOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
} from '@ant-design/icons';

const { Sider, Content } = AntLayout;

const menuItems = [
  { key: '/overview', icon: <DashboardOutlined />, label: '管理总览' },
  { key: '/task-timeline', icon: <CalendarOutlined />, label: '时间任务看板' },
  { key: '/kanban', icon: <ProjectOutlined />, label: '任务流转' },
  { key: '/workload', icon: <TeamOutlined />, label: '小组负荷' },
  { key: '/tasks/register', icon: <FormOutlined />, label: '任务登记' },
  { key: '/rescan', icon: <SyncOutlined />, label: '回扫登记' },
  { key: '/ledger-import', icon: <ImportOutlined />, label: '台账拉取' },
  { key: '/system-monitor', icon: <MonitorOutlined />, label: '建设监测' },
];

export default function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <AntLayout className="app-shell">
      <Sider width={200} collapsedWidth={72} collapsible collapsed={collapsed} trigger={null} theme="dark" className="app-sider">
        <button className="nav-collapse-trigger" onClick={() => setCollapsed(value => !value)} aria-label={collapsed ? '展开导航' : '收起导航'}>
          {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
        </button>
        <div className={`brand ${collapsed ? 'is-collapsed' : ''}`}><span className="brand-mark">一</span>{!collapsed && <span>小助理看板</span>}</div>
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
          <div className="page-frame"><Outlet /></div>
        </Content>
      </AntLayout>
    </AntLayout>
  );
}
