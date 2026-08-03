import { Card, Table, Tag, Row, Col } from 'antd';
import ReactECharts from 'echarts-for-react';
import { getMemberWorkload } from '@/services/statsService';
import { Member } from '@/types';
import { ALL_TEAMS } from '@/constants';
import { getTasks } from '@/services/taskService';
import { useEffect, useState } from 'react';

export default function Workload() {
  const [members, setMembers] = useState<Member[]>([]);
  useEffect(() => { getTasks().then(tasks => setMembers(getMemberWorkload(tasks))); }, []);
  const avgPoints = members.reduce((s, m) => s + m.difficultyPoints, 0) / members.length;

  const columns = [
    { title: '姓名', dataIndex: 'name', key: 'name', width: 80 },
    { title: '小组', dataIndex: 'team', key: 'team', width: 80 },
    { title: '角色', dataIndex: 'role', key: 'role', width: 80,
      render: (r: string) => r === 'leader' ? <Tag color="gold">组长</Tag> : <Tag>助理</Tag> },
    { title: '进行中任务数', dataIndex: 'activeTasks', key: 'activeTasks', width: 100,
      sorter: (a: Member, b: Member) => a.activeTasks - b.activeTasks },
    { title: '当前难度点', dataIndex: 'difficultyPoints', key: 'difficultyPoints', width: 110,
      sorter: (a: Member, b: Member) => a.difficultyPoints - b.difficultyPoints,
      render: (p: number) => {
        const isHigh = p > avgPoints * 1.5;
        return <span style={{ color: isHigh ? '#eb687b' : undefined, fontWeight: isHigh ? 600 : 400 }}>{p} {isHigh && '⚠'}</span>;
      }},
    { title: '近4周完成点', dataIndex: 'completedPoints4w', key: 'completedPoints4w', width: 120,
      sorter: (a: Member, b: Member) => a.completedPoints4w - b.completedPoints4w },
  ];

  const workloadChartOption = {
    tooltip: { trigger: 'axis' },
    legend: { data: ['当前难度点', '近4周完成点'] },
    xAxis: { type: 'category', data: members.map(m => m.name), axisLabel: { rotate: 30 } },
    yAxis: { type: 'value', name: '点数' },
    series: [
      { name: '当前难度点', type: 'bar', data: members.map(m => m.difficultyPoints), itemStyle: { color: '#b97d7b' },
        markLine: { data: [{ type: 'average', name: '平均' }], lineStyle: { color: '#b97d7b', type: 'dashed' } } },
      { name: '近4周完成点', type: 'bar', data: members.map(m => m.completedPoints4w), itemStyle: { color: '#928e5e' } },
    ],
  };

  const teamCompareOption = {
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: ALL_TEAMS },
    yAxis: { type: 'value' },
    series: [
      {
        name: '平均负荷点',
        type: 'bar',
        data: ALL_TEAMS.map(team => {
          const teamMembers = members.filter(m => m.team === team);
          return Math.round(teamMembers.reduce((s, m) => s + m.difficultyPoints, 0) / teamMembers.length);
        }),
        itemStyle: { color: '#c1a0ac' },
      },
    ],
  };

  return (
    <div>
      <h2 style={{ marginBottom: 16 }}>小组负荷分析</h2>

      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={14}>
          <Card title="成员负荷对比">
            <ReactECharts option={workloadChartOption} style={{ height: 280 }} />
          </Card>
        </Col>
        <Col span={10}>
          <Card title="小组平均负荷">
            <ReactECharts option={teamCompareOption} style={{ height: 280 }} />
          </Card>
        </Col>
      </Row>

      <Card title="成员明细">
        <Table
          dataSource={members}
          columns={columns}
          rowKey="id"
          size="small"
          pagination={false}
        />
        <div style={{ marginTop: 12, fontSize: 12, color: 'var(--ink-soft)' }}>
          团队人均难度点：{Math.round(avgPoints)}，超过 {Math.round(avgPoints * 1.5)} 点标记为负荷过高
        </div>
      </Card>
    </div>
  );
}
