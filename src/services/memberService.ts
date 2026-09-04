import { ALL_TEAMS, TEAM_LEADERS, TEAM_MEMBERS, Team } from '@/constants';
import { ensureOnedayClient } from '@/onedaycloud';
import { USE_MOCK } from './db';

export interface ManagedMember { id: string; name: string; team: Team; role: '组长' | '组员'; status: '在职' | '已停用'; }
let localMembers: ManagedMember[] = ALL_TEAMS.flatMap(team => TEAM_MEMBERS[team].map(name => ({ id: `${team}-${name}`, name, team, role: TEAM_LEADERS[team] === name ? '组长' as const : '组员' as const, status: '在职' as const })));
export async function getManagedMembers(): Promise<ManagedMember[]> {
  if (USE_MOCK) return localMembers;
  const client = ensureOnedayClient();
  if (!client) throw new Error('Supabase 尚未配置');
  const { data, error } = await client.supabase.from('managed_members').select('*').order('team').order('name');
  if (error) throw error;
  return (data || []).map((row: any) => ({ id: row.id, name: row.name, team: row.team as Team, role: row.role, status: row.status }));
}
export async function saveManagedMember(input: Omit<ManagedMember, 'id'> & { id?: string }) {
  if (USE_MOCK && input.id) { localMembers = localMembers.map(member => member.id === input.id ? { ...member, ...input } : member); return localMembers.find(member => member.id === input.id)!; }
  if (USE_MOCK) { const item: ManagedMember = { ...input, id: `member-${Date.now()}` }; localMembers = [...localMembers, item]; return item; }
  const client = ensureOnedayClient();
  if (!client) throw new Error('Supabase 尚未配置');
  const { data, error } = await client.supabase.rpc('save_managed_member', {
    p_id: input.id || null, p_name: input.name, p_team_name: input.team,
    p_role: input.role === '组长' ? 'leader' : 'member', p_status: input.status === '在职' ? 'active' : 'disabled',
  });
  if (error) throw error;
  return data as ManagedMember;
}
export async function toggleManagedMember(id: string) {
  if (USE_MOCK) { localMembers = localMembers.map(member => member.id === id ? { ...member, status: member.status === '在职' ? '已停用' : '在职' } : member); return; }
  const client = ensureOnedayClient();
  if (!client) throw new Error('Supabase 尚未配置');
  const { error } = await client.supabase.rpc('toggle_managed_member', { p_id: id });
  if (error) throw error;
}
