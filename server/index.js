const express = require('express');
const cors = require('cors');
const { API_VERSION, resources, registerApiContracts } = require('./apiContracts');

const app = express();
const PORT = 3020;

app.use(cors());
app.use(express.json());
app.set('trust proxy', true);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString(), apiVersion: API_VERSION, oneDayAdapterConfigured: false });
});

// 对外API预留 —— 供大系统调用
app.get('/api/tasks', (req, res) => {
  res.json({ message: '待接入 OneDay Cloud 数据库', data: [] });
});

app.get('/api/tasks/:id', (req, res) => {
  res.json({ message: '待接入', data: null });
});

app.post('/api/tasks', (req, res) => {
  res.json({ message: '待接入', data: req.body });
});

app.put('/api/tasks/:id/status', (req, res) => {
  res.json({ message: '待接入', data: { id: req.params.id, ...req.body } });
});

app.get('/api/members/workload', (req, res) => {
  res.json({ message: '待接入', data: [] });
});

app.get('/api/stats/overview', (req, res) => {
  res.json({ message: '待接入', data: {} });
});

app.get('/api/alerts', (req, res) => {
  res.json({ message: '待接入', data: [] });
});

registerApiContracts(app);

app.use((req, res) => {
  res.status(404).json({ code: 'NOT_FOUND', message: '接口不存在', path: req.path, availableResources: resources.length });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[server] Express running on port ${PORT}`);
});
