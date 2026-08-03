const API_VERSION = 'v1';

const resources = [
  ['GET', '/auth/me', '读取当前已验证用户、角色和小组'],
  ['POST', '/auth/login', '独立运行时由 OneDay Auth 执行账号密码登录'],
  ['POST', '/auth/logout', '退出当前会话'],
  ['GET', '/users', '管理员读取用户、小组和角色'],
  ['PATCH', '/users/:id', '管理员调整用户资料与角色'],
  ['GET', '/tasks', '按当前权限读取任务'],
  ['POST', '/tasks', '创建任务或从导入批次确认入库'],
  ['GET', '/tasks/:id', '读取任务全生命周期档案'],
  ['PATCH', '/tasks/:id', '更新允许编辑的任务基础字段'],
  ['POST', '/tasks/:id/difficulty-revisions', '组长预填或最终确认难度，必须留痕'],
  ['GET', '/tasks/:id/contributions', '读取结项时的人员工作标签记录'],
  ['POST', '/tasks/:id/contributions', '组长给组员挂载工作标签及可选证据'],
  ['DELETE', '/tasks/:id/contributions/:contributionId', '移除尚未结项的人员工作标签'],
  ['GET', '/tasks/:id/settlement', '读取任务结项确认摘要'],
  ['POST', '/tasks/:id/settlement', '组长确认最终星级、参与记录并结项'],
  ['GET', '/tasks/:id/progress', '读取作业平台进度快照'],
  ['POST', '/tasks/:id/progress', '服务账号写入平台进度快照'],
  ['GET', '/tasks/:id/documents', '读取任务文档与验收状态'],
  ['POST', '/documents/upload-intents', '申请对象存储上传地址'],
  ['POST', '/documents', '登记上传完成的文档版本'],
  ['POST', '/documents/:id/reviews', '组长验收或驳回文档'],
  ['POST', '/tasks/:id/rule-changes', '登记规则变更及关联版本'],
  ['GET', '/rescans', '读取回扫事件'],
  ['POST', '/rescans', '创建或确认回扫事件'],
  ['PATCH', '/rescans/:id', '更新回扫状态、关联任务和验收'],
  ['POST', '/imports/task-ledger/preview', '预览任务台账并生成导入批次'],
  ['POST', '/imports/rescan-ledger/preview', '预览借调台账并生成匹配队列'],
  ['POST', '/imports/:batchId/commit', '确认导入有效记录'],
  ['GET', '/imports/:batchId', '读取导入结果、错误行和待确认项'],
  ['GET', '/dashboard/overview', '读取四组事实型总览'],
  ['GET', '/dashboard/risks', '读取重点风险任务'],
  ['GET', '/audit-logs', '管理员读取审计日志'],
  ['GET', '/integration/status', '读取所有外部数据源的连接与同步状态'],
  ['POST', '/integration/tasks/upsert', '未来调度系统幂等写入任务基础数据'],
  ['POST', '/integration/tasks/:externalTaskId/progress', '未来调度系统写入进度'],
  ['POST', '/integration/webhooks/task-events', '未来调度系统 Webhook 入口'],
  ['GET', '/integration/tasks/:externalTaskId/status', '向调度系统返回本平台任务状态'],
];

function contractResponse(req, res) {
  res.status(501).json({
    code: 'ONEDAY_ADAPTER_NOT_CONFIGURED',
    message: '接口契约已就绪，等待在 1d 内网配置 OneDay Auth、数据库与对象存储适配器。',
    requestId: req.headers['x-request-id'] || null,
  });
}

function registerApiContracts(app) {
  app.get(`/api/${API_VERSION}`, (_req, res) => res.json({ version: API_VERSION, resources }));
  resources.forEach(([method, path]) => {
    const handler = contractResponse;
    app[method.toLowerCase()](`/api/${API_VERSION}${path}`, handler);
  });
}

module.exports = { API_VERSION, resources, registerApiContracts };
