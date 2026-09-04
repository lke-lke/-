import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Overview from './pages/Overview';
import Kanban from './pages/Kanban';
import Workload from './pages/Workload';
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
import { ActorProvider } from './contexts/ActorContext';
import AuthGate from './components/AuthGate';

export default function App() {
  return (
    <ActorProvider><AuthGate><HashRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/overview" replace />} />
          <Route path="system-monitor" element={<SystemMonitor />} />
          <Route path="ledger-import" element={<LedgerImport />} />
          <Route path="task-timeline" element={<TaskTimeline />} />
          <Route path="overview" element={<Overview />} />
          <Route path="kanban" element={<Kanban />} />
          <Route path="workload" element={<Workload />} />
          <Route path="task-relations" element={<TaskRelations />} />
          <Route path="members" element={<MemberManagement />} />
          <Route path="team-tasks" element={<TeamTasks />} />
          <Route path="personal-work" element={<PersonalWork />} />
          <Route path="my-deliverables" element={<MyDeliverables />} />
          <Route path="management-ledger" element={<ManagementLedger />} />
          <Route path="tasks/register" element={<TaskRegister />} />
          <Route path="tasks/:id" element={<TaskDetail />} />
          <Route path="rescan" element={<RescanLog />} />
        </Route>
      </Routes>
    </HashRouter></AuthGate></ActorProvider>
  );
}
