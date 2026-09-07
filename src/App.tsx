import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Overview from './pages/Overview';
import Kanban from './pages/Kanban';
import TaskDetail from './pages/TaskDetail';
import TaskRegister from './pages/TaskRegister';
import RescanLog from './pages/RescanLog';
import SystemMonitor from './pages/SystemMonitor';
import LedgerImport from './pages/LedgerImport';
import TaskTimeline from './pages/TaskTimeline';
import TaskRelations from './pages/TaskRelations';
import MemberManagement from './pages/MemberManagement';
import TeamTasks from './pages/TeamTasks';
import PersonalWork from './pages/PersonalWork';
import ManagementLedger from './pages/ManagementLedger';
import MyDeliverables from './pages/MyDeliverables';
import { ActorProvider, ActorRole, useActor } from './contexts/ActorContext';
import AuthGate from './components/AuthGate';

function RoleGate({ allowed, children }: { allowed: ActorRole[]; children: React.ReactElement }) {
  const { actor } = useActor();
  return allowed.includes(actor.role) ? children : <Navigate to="/overview" replace />;
}

const GLOBAL_ROLES: ActorRole[] = ['超级管理员', '管理员'];
const MANAGER_ROLES: ActorRole[] = ['超级管理员', '管理员', '组长'];

export default function App() {
  return (
    <ActorProvider><AuthGate><HashRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/overview" replace />} />
          <Route path="system-monitor" element={<RoleGate allowed={GLOBAL_ROLES}><SystemMonitor /></RoleGate>} />
          <Route path="ledger-import" element={<RoleGate allowed={MANAGER_ROLES}><LedgerImport /></RoleGate>} />
          <Route path="task-timeline" element={<RoleGate allowed={GLOBAL_ROLES}><TaskTimeline /></RoleGate>} />
          <Route path="overview" element={<Overview />} />
          <Route path="kanban" element={<RoleGate allowed={MANAGER_ROLES}><Kanban /></RoleGate>} />
          <Route path="workload" element={<RoleGate allowed={MANAGER_ROLES}><Navigate to="/personal-work" replace /></RoleGate>} />
          <Route path="task-relations" element={<RoleGate allowed={MANAGER_ROLES}><TaskRelations /></RoleGate>} />
          <Route path="members" element={<RoleGate allowed={MANAGER_ROLES}><MemberManagement /></RoleGate>} />
          <Route path="team-tasks" element={<RoleGate allowed={MANAGER_ROLES}><TeamTasks /></RoleGate>} />
          <Route path="personal-work" element={<PersonalWork />} />
          <Route path="my-deliverables" element={<MyDeliverables />} />
          <Route path="management-ledger" element={<RoleGate allowed={MANAGER_ROLES}><ManagementLedger /></RoleGate>} />
          <Route path="tasks/register" element={<TaskRegister />} />
          <Route path="tasks/:id" element={<TaskDetail />} />
          <Route path="rescan" element={<RoleGate allowed={MANAGER_ROLES}><RescanLog /></RoleGate>} />
        </Route>
      </Routes>
    </HashRouter></AuthGate></ActorProvider>
  );
}
