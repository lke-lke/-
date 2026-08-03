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

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/system-monitor" replace />} />
          <Route path="system-monitor" element={<SystemMonitor />} />
          <Route path="ledger-import" element={<LedgerImport />} />
          <Route path="task-timeline" element={<TaskTimeline />} />
          <Route path="overview" element={<Overview />} />
          <Route path="kanban" element={<Kanban />} />
          <Route path="workload" element={<Workload />} />
          <Route path="tasks/register" element={<TaskRegister />} />
          <Route path="tasks/:id" element={<TaskDetail />} />
          <Route path="rescan" element={<RescanLog />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
