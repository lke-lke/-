import { createContext, ReactNode, useContext, useMemo, useState } from 'react';
import { ALL_TEAMS, Team } from '@/constants';

export type StandardActorRole = '管理员' | '组长' | '组员';
export type ActorRole = '超级管理员' | StandardActorRole;
export interface CurrentActor { name: string; role: ActorRole; team?: Team; }
export const isGlobalManagerRole = (role: ActorRole) => role === '管理员' || role === '超级管理员';
export const isSuperAdminRole = (role: ActorRole) => role === '超级管理员';

const defaultActor: CurrentActor = { name: '组长', role: '组长', team: ALL_TEAMS[0] };
interface ActorContextValue {
  /** 当前页面实际采用的权限视角；超级管理员预览其他角色时会切换为对应角色。 */
  actor: CurrentActor;
  /** 真实登录身份，用于权限和审计展示。 */
  actualActor: CurrentActor;
  previewRole?: StandardActorRole;
  isPreviewMode: boolean;
  setActor: (actor: CurrentActor) => void;
  setPreviewRole: (role?: StandardActorRole) => void;
}
const ActorContext = createContext<ActorContextValue>({ actor: defaultActor, actualActor: defaultActor, isPreviewMode: false, setActor: () => undefined, setPreviewRole: () => undefined });

export function ActorProvider({ children }: { children: ReactNode }) {
  const [actualActor, setActualActor] = useState<CurrentActor>(defaultActor);
  const [previewRole, setPreviewRole] = useState<StandardActorRole>();
  const actor = actualActor.role === '超级管理员' && previewRole
    ? ACTOR_OPTIONS.find(option => option.role === previewRole) || actualActor
    : actualActor;
  const setActor = (nextActor: CurrentActor) => {
    setActualActor(nextActor);
    if (nextActor.role !== '超级管理员') setPreviewRole(undefined);
  };
  const setPreview = (role?: StandardActorRole) => setPreviewRole(actualActor.role === '超级管理员' ? role : undefined);
  return <ActorContext.Provider value={useMemo(() => ({ actor, actualActor, previewRole, isPreviewMode: actualActor.role === '超级管理员' && Boolean(previewRole), setActor, setPreviewRole: setPreview }), [actor, actualActor, previewRole])}>{children}</ActorContext.Provider>;
}

export function useActor() { return useContext(ActorContext); }

export const ACTOR_OPTIONS: CurrentActor[] = [
  { name: '超级管理员', role: '超级管理员' },
  { name: '管理员', role: '管理员' },
  { name: '组长', role: '组长', team: ALL_TEAMS[0] },
  { name: '组员', role: '组员', team: ALL_TEAMS[0] },
];
