import { Alert, Button, Card, Col, Descriptions, Progress, Row, Table, Tag } from 'antd';
import { CheckCircleFilled, ReloadOutlined, WarningFilled } from '@ant-design/icons';
import { useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { USE_MOCK } from '@/services/db';

type BuildStatus = '已完成' | '进行中' | '待接入';

interface BuildItem {
  key: string;
  module: string;
  status: BuildStatus;
  progress: number;
  detail: string;
  nextAction: string;
}

const statusColors: Record<BuildStatus, string> = {
  已完成: 'success',
  进行中: 'processing',
  待接入: 'warning',
};

function getBuildItems(): BuildItem[] {
  return [
    { key: 'task', module: '任务下发登记', status: '已完成', progress: 100, detail: '登记表单、任务台账、状态流转均可用', nextAction: '结合真实台账验证字段' },
    { key: 'rescan', module: '回扫/变更登记', status: '已完成', progress: 100, detail: '回扫登记及原任务关联已实现', nextAction: '导入历史借调台账' },
    { key: 'document', module: '文档归档与难度评分', status: '已完成', progress: 100, detail: '文档齐套度与任务状态自动联动', nextAction: '接入正式文件存储' },
    { key: 'dashboard', module: '管理总览与负荷分析', status: '已完成', progress: 100, detail: '按小组展示周/月/季度任务与负荷', nextAction: '接入真实数据后校验指标' },
    { key: 'database', module: 'OneDay Cloud 数据库', status: USE_MOCK ? '待接入' : '已完成', progress: USE_MOCK ? 30 : 100, detail: USE_MOCK ? '当前使用 Mock 数据，数据库尚未启用' : '已连接 OneDay Cloud 数据库', nextAction: USE_MOCK ? '开通 Cloud 并执行 schema.sql' : '验证生产读写权限' },
    { key: 'platform', module: '标注平台进度同步', status: '待接入', progress: 15, detail: '等待内部标注平台 API 文档', nextAction: '提供接口后配置 2 小时同步任务' },
    { key: 'alert', module: '异常预警推送', status: '进行中', progress: 60, detail: '逾期、停滞、文档缺失规则已就绪', nextAction: '接入钉钉工作通知' },
    { key: 'migration', module: '历史数据迁移', status: '待接入', progress: 0, detail: '两张钉钉台账尚未导入', nextAction: '提供导出数据并完成字段映射' },
  ];
}

export default function SystemMonitor() {
  const [refreshedAt, setRefreshedAt] = useState(dayjs());
  const items = useMemo(getBuildItems, []);
  const completed = items.filter(item => item.status === '已完成').length;
  const pending = items.filter(item => item.status !== '已完成').length;
  const completion = Math.round(items.reduce((sum, item) => sum + item.progress, 0) / items.length);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0 }}>系统建设监测</h2>
          <span style={{ color: 'var(--ink-soft)', fontSize: 12 }}>最后刷新：{refreshedAt.format('YYYY-MM-DD HH:mm:ss')}</span>
        </div>
        <Button icon={<ReloadOutlined />} onClick={() => setRefreshedAt(dayjs())}>刷新状态</Button>
      </div>

      <Alert
        showIcon
        type={USE_MOCK ? 'warning' : 'success'}
        message={USE_MOCK ? '当前为演示数据模式：核心前端可用，尚未连接 OneDay Cloud。' : '当前已连接 OneDay Cloud 数据库。'}
        style={{ marginBottom: 16 }}
      />

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} md={8}>
          <Card><Progress type="dashboard" percent={completion} strokeColor="#806c79" format={p => `${p}%`} /><div style={{ textAlign: 'center', marginTop: 8 }}>整体建设完成度</div></Card>
        </Col>
        <Col xs={24} md={8}>
          <Card>
            <CheckCircleFilled style={{ color: '#928e5e', fontSize: 28 }} />
            <div style={{ fontSize: 28, fontWeight: 600, marginTop: 8 }}>{completed}</div>
            <div style={{ color: 'var(--ink-soft)' }}>已完成模块</div>
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card>
            <WarningFilled style={{ color: '#b97d7b', fontSize: 28 }} />
            <div style={{ fontSize: 28, fontWeight: 600, marginTop: 8 }}>{pending}</div>
            <div style={{ color: 'var(--ink-soft)' }}>需要推进的模块</div>
          </Card>
        </Col>
      </Row>

      <Card title="模块建设进度" style={{ marginBottom: 16 }}>
        <Table
          rowKey="key"
          pagination={false}
          dataSource={items}
          columns={[
            { title: '模块', dataIndex: 'module', width: 180, render: (value: string) => <strong>{value}</strong> },
            { title: '状态', dataIndex: 'status', width: 100, render: (value: BuildStatus) => <Tag color={statusColors[value]}>{value}</Tag> },
            { title: '完成度', dataIndex: 'progress', width: 180, render: (value: number) => <Progress percent={value} size="small" /> },
            { title: '当前情况', dataIndex: 'detail' },
            { title: '下一步', dataIndex: 'nextAction' },
          ]}
        />
      </Card>

      <Card title="当前运行配置">
        <Descriptions column={{ xs: 1, sm: 2, md: 3 }} size="small">
          <Descriptions.Item label="前端路由">HashRouter</Descriptions.Item>
          <Descriptions.Item label="数据源">{USE_MOCK ? 'Mock 演示数据' : 'OneDay Cloud'}</Descriptions.Item>
          <Descriptions.Item label="构建验证">TypeScript / webpack 已通过</Descriptions.Item>
        </Descriptions>
      </Card>
    </div>
  );
}
