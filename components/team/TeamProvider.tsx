'use client';

import { createContext, useContext, useMemo } from 'react';
import type { TeamProfiel } from '@/lib/team/types';

// Het team (namen, initialen, kleuren) en wie er ingelogd is, voor alle client-componenten
// in de shell. Wordt één keer per verzoek geladen in app/(app)/layout.tsx.
interface TeamContext {
  mijnId: string;
  leden: TeamProfiel[];
  perId: Map<string, TeamProfiel>;
}

const Ctx = createContext<TeamContext>({ mijnId: '', leden: [], perId: new Map() });

export function TeamProvider({
  mijnId,
  leden,
  children
}: {
  mijnId: string;
  leden: TeamProfiel[];
  children: React.ReactNode;
}) {
  const waarde = useMemo(() => ({ mijnId, leden, perId: new Map(leden.map((l) => [l.id, l])) }), [mijnId, leden]);
  return <Ctx.Provider value={waarde}>{children}</Ctx.Provider>;
}

export function useTeam(): TeamContext {
  return useContext(Ctx);
}

/** Alleen de actieve teamleden (voor kiezers). */
export function useActieveLeden(): TeamProfiel[] {
  const { leden } = useTeam();
  return useMemo(() => leden.filter((l) => l.actief), [leden]);
}
