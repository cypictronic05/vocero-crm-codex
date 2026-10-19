export type AssignmentCandidate = {
  id: string;
  createdAt: Date;
};

/** Selección determinista: menor carga, mayor antigüedad, identificador. */
export function pickLeastLoadedMember(
  candidates: AssignmentCandidate[],
  loads: ReadonlyMap<string, number>
): string | null {
  const ranked = [...candidates].sort(
    (a, b) =>
      (loads.get(a.id) ?? 0) - (loads.get(b.id) ?? 0) ||
      a.createdAt.getTime() - b.createdAt.getTime() ||
      a.id.localeCompare(b.id)
  );
  return ranked[0]?.id ?? null;
}
