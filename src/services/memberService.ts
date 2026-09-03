import { ALL_TEAMS, TEAM_LEADERS, TEAM_MEMBERS, Team } from '@/constants';

export interface ManagedMember { id: string; name: string; team: Team; role: '组长' | '组员'; status: '在职' | '已停用'; }
let localMembers: ManagedMember[] = ALL_TEAMS.flatMap(team => TEAM_MEMBERS[team].map(name => ({ id: `${team}-${name}`, name, team, role: TEAM_LEADERS[team] === name ? '组长' as const : '组员' as const, status: '在职' as const })));
export async function getManagedMembers() { return localMembers; }
export async function saveManagedMember(input: Omit<ManagedMember, 'id'> & { id?: string }) {
  if (input.id) { localMembers = localMembers.map(member => member.id === input.id ? { ...member, ...input } : member); return localMembers.find(member => member.id === input.id)!; }
  const item: ManagedMember = { ...input, id: `member-${Date.now()}` }; localMembers = [...localMembers, item]; return item;
}
export async function toggleManagedMember(id: string) { localMembers = localMembers.map(member => member.id === id ? { ...member, status: member.status === '在职' ? '已停用' : '在职' } : member); }
