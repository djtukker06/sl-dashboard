'use client';

import { createContext, useContext, useMemo } from 'react';
import type { TeamProfiel } from '@/lib/team/types';

// Het team (namen, initialen, kleuren) en wie er ingelogd is, voor alle client-componenten
// in de shell. Wordt één keer per verzoek geladen in app/(app)/layout.tsx.
interface TeamContext {
  mijnId: string;
  /** true zolang migratie 0021 niet is uitgevoerd (geen toewijzing, subtaken of projecten). */
  overgang: boolean;
  leden: TeamProfiel[];
  perId: Map<string, TeamProfiel>;
}

const Ctx = createContext<TeamContext>({ mijnId: '', overgang: false, leden: [], perId: new Map() });

export function TeamProvider({
  mijnId,
  overgang = false,
  leden,
  children
}: {
  mijnId: string;
  overgang?: boolean;
  leden: TeamProfiel[];
  children: React.ReactNode;
}) {
  const waarde = useMemo(
    () => ({ mijnId, overgang, leden, perId: new Map(leden.map((l) => [l.id, l])) }),
    [mijnId, overgang, leden]
  );
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
