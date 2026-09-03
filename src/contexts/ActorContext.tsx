import { createContext, ReactNode, useContext, useMemo, useState } from 'react';
import { ALL_TEAMS, Team } from '@/constants';

export type ActorRole = '管理员' | '组长' | '组员';
export interface CurrentActor { name: string; role: ActorRole; team?: Team; }

const defaultActor: CurrentActor = { name: '组长', role: '组长', team: ALL_TEAMS[0] };
const ActorContext = createContext<{ actor: CurrentActor; setActor: (actor: CurrentActor) => void }>({ actor: defaultActor, setActor: () => undefined });

export function ActorProvider({ children }: { children: ReactNode }) {
  const [actor, setActor] = useState<CurrentActor>(defaultActor);
  return <ActorContext.Provider value={useMemo(() => ({ actor, setActor }), [actor])}>{children}</ActorContext.Provider>;
}

export function useActor() { return useContext(ActorContext); }

export const ACTOR_OPTIONS: CurrentActor[] = [
  { name: '管理员', role: '管理员' },
  { name: '组长', role: '组长', team: ALL_TEAMS[0] },
  { name: '组员', role: '组员', team: ALL_TEAMS[0] },
];
