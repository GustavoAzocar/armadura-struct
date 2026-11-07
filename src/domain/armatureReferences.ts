/** Explicit graphical dependencies. These links never create physical steel. */
export type ArmatureReferenceObject = {
  id: string;
  barId?: string;
  barIds?: string[];
};
export function armatureReferences(value: object): string[] {
  const object = value as { barId?: string; barIds?: string[] };
  return [
    ...new Set([
      ...(object.barId ? [object.barId] : []),
      ...(object.barIds ?? []),
    ]),
  ];
}
/** Stable keys retain the original single-reference import contract. */
export function armatureReferenceEdges<T extends ArmatureReferenceObject>(
  object: T,
): { object: T & { barId: string }; primary: boolean }[] {
  return [
    ...(object.barId
      ? [{ object: { ...object, barId: object.barId }, primary: true }]
      : []),
    ...(object.barIds ?? []).map((barId, index) => ({
      object: { ...object, id: `${object.id}/barIds/${index}`, barId },
      primary: false,
    })),
  ];
}
