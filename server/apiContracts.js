const API_VERSION = 'v1';

const resources = [
  ['GET', '/auth/me', '读取当前已验证用户、角色和小组'],
  ['POST', '/auth/login', '独立运行时由 OneDay Auth 执行账号密码登录'],
  ['POST', '/auth/logout', '退出当前会话'],
  ['GET', '/users', '管理员读取用户、小组和角色'],
  ['POST', '/users', '筝一或组长新增本组成员'],
  ['PATCH', '/users/:id', '管理员调整用户资料与角色'],
  ['PATCH', '/users/:id/status', '筝一或组长启用、停用或调组成员，保留历史归属'],
  ['GET', '/task-relations', '读取任务归属、主任务、关联任务的层级关系库'],
  ['POST', '/task-relations', '筝一或组长新增关联任务关系'],
  ['PATCH', '/task-relations/:id', '筝一或组长修改任务关系'],
  ['DELETE', '/task-relations/:id', '逻辑停用任务关系，历史任务不删除'],
  ['GET', '/tasks', '按当前权限读取任务'],
  ['POST', '/tasks', '组长手动创建完整任务；需写入预计截止时间、实际截止时间及三级任务挂链'],
  ['GET', '/tasks/:id', '读取任务全生命周期档案'],
  ['PATCH', '/tasks/:id', '组长完善导入任务或更新基础字段；待完善任务补齐三级挂链和两类截止时间后转进行中'],
  ['GET', '/tasks/:id/field-changes', '读取截止时间、数据量、难度等字段修改留痕'],
  ['POST', '/tasks/:id/difficulty-revisions', '组长预填或最终确认难度，必须留痕'],
  ['GET', '/tasks/:id/contributions', '读取结项时的人员工作标签记录'],
  ['POST', '/tasks/:id/contributions', '成员登记本人工作标签，或组长代登记标签及可选证据'],
  ['POST', '/tasks/:id/contributions/:contributionId/confirm', '组长确认成员登记的工作标签后计入统计'],
  ['DELETE', '/tasks/:id/contributions/:contributionId', '移除尚未结项的人员工作标签'],
  ['GET', '/tasks/:id/settlement', '读取任务结项确认摘要'],
  ['POST', '/tasks/:id/settlement', '组长确认最终星级、参与记录并结项'],
  ['GET', '/tasks/:id/progress', '读取作业平台进度快照'],
  ['POST', '/tasks/:id/progress', '服务账号写入平台进度快照'],
  ['GET', '/tasks/:id/documents', '读取任务文档与验收状态'],
  ['POST', '/documents/upload-intents', '申请对象存储上传地址'],
  ['POST', '/documents', '登记上传完成的文档版本'],
  ['POST', '/documents/:id/reviews', '组长首次验收三选一：退回组员、组长验收结案、提交管理员二级验收'],
  ['POST', '/documents/:id/admin-submissions', '组长将交付物提交或重新提交管理员；进入该路线后不可降级'],
  ['POST', '/documents/:id/admin-reviews', '管理员二级验收或驳回；通过后最终结案，驳回后回流组长'],
  ['POST', '/documents/:id/revision-disposition', '组长处理管理员驳回：退回组员上传新版本，或直接修改后重提管理员'],
  ['GET', '/documents/:id/review-events', '按交付物根记录读取跨版本、跨角色的完整审核留痕'],
  ['POST', '/tasks/:id/rule-changes', '登记规则变更及关联版本'],
  ['GET', '/rescans', '读取回扫事件'],
  ['POST', '/rescans', '创建或确认回扫事件'],
  ['PATCH', '/rescans/:id', '更新回扫状态、关联任务和验收'],
  ['POST', '/imports/task-ledger/preview', '预览任务台账并生成导入批次'],
  ['POST', '/imports/rescan-ledger/preview', '预览借调台账并生成匹配队列'],
  ['POST', '/imports/:batchId/commit', '确认导入有效记录并以待完善状态分配至小组/组长'],
  ['GET', '/imports/:batchId', '读取导入结果、错误行和待确认项'],
  ['GET', '/dashboard/overview', '读取四组事实型总览'],
  ['GET', '/dashboard/risks', '读取重点风险任务'],
  ['GET', '/dashboard/personal-work', '按成员、小组、日期读取已确认工作量和类型分布'],
  ['GET', '/dashboard/management-ledger', '读取任务下发、提醒、验收、逾期等管理交互表'],
  ['GET', '/alerts', '读取临期、逾期、字段缺失等页面提醒'],
  ['POST', '/notifications/dingtalk', '由服务端向已授权的钉钉用户发送提醒，不暴露钉钉凭据'],
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
