import { Layout as AntLayout, Menu, Select, message } from 'antd';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useState } from 'react';
import { DashboardOutlined, ProjectOutlined, TeamOutlined, FormOutlined, SyncOutlined, ImportOutlined, UsergroupAddOutlined, MenuFoldOutlined, MenuUnfoldOutlined, SettingOutlined, CalendarOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { ACTOR_OPTIONS, StandardActorRole, useActor } from '@/contexts/ActorContext';
import { DATA_MODE } from '@/services/db';
import { ensureOnedayClient } from '@/onedaycloud';

const { Sider, Content } = AntLayout;

function getMenuItems(role: string) {
  if (role === '超级管理员') return [
    { key: '/overview', icon: <DashboardOutlined />, label: '全局总览' },
    { key: '/tasks/register', icon: <ProjectOutlined />, label: '任务全景' },
    { key: '/management-ledger', icon: <FormOutlined />, label: '审核中心' },
    { key: '/personal-work', icon: <TeamOutlined />, label: '人员作业明细' },
    { key: '/my-deliverables', icon: <SyncOutlined />, label: '全部交付物' },
    { key: '/ledger-import', icon: <ImportOutlined />, label: '数据导入' },
    { key: '/rescan', icon: <SyncOutlined />, label: '回扫登记' },
    { key: '/task-timeline', icon: <CalendarOutlined />, label: '时间任务看板' },
    { key: 'settings', icon: <SettingOutlined />, label: '组织与系统', children: [{ key: '/members', label: '成员与小组' }, { key: '/task-relations', label: '任务关系' }, { key: '/system-monitor', label: '系统设置' }] },
  ];
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
  const { actor, actualActor, isPreviewMode, previewRole, setActor, setPreviewRole } = useActor();
  const menuItems = getMenuItems(actor.role);

  const changeLoginRole = async (value: string) => {
    const selected = ACTOR_OPTIONS.find(option => option.role === value);
    if (!selected) return;
    if (DATA_MODE === 'supabase') {
      const role = value === '超级管理员' ? 'super_admin' : value === '管理员' ? 'admin' : value === '组长' ? 'leader' : 'member';
      const client = ensureOnedayClient();
      const { error } = client ? await client.supabase.rpc('set_local_demo_role', { p_role: role }) : { error: new Error('Supabase 尚未配置') };
      if (error) return message.error(error.message);
    }
    setActor(selected);
  };

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
          <div className="actor-bar"><span>当前登录身份</span><Select size="small" value={actualActor.role} onChange={changeLoginRole} options={ACTOR_OPTIONS.map(option => ({ value: option.role, label: option.role }))} />
            {actualActor.role === '超级管理员' && <><span className="actor-preview-label"><SafetyCertificateOutlined /> 查看角色视角</span><Select size="small" value={previewRole || '超级管理员操作'} onChange={value => setPreviewRole(value === '超级管理员操作' ? undefined : value as StandardActorRole)} options={[{ value: '超级管理员操作', label: '超级管理员操作' }, { value: '管理员', label: '管理员视角（只读）' }, { value: '组长', label: '组长视角（只读）' }, { value: '组员', label: '组员视角（只读）' }]} /></>}</div>
          {isPreviewMode && <div className="preview-mode-banner">当前为“{actor.role}”只读预览视角。页面数据范围与菜单按该角色呈现；请切回“超级管理员操作”后再进行修改、审核或提交。</div>}
          <div className={`page-frame ${isPreviewMode ? 'preview-readonly-content' : ''}`}><Outlet /></div>
        </Content>
      </AntLayout>
    </AntLayout>
  );
}
