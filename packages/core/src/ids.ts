/**
 * Deterministic, Project-local id generation: the first unused `${prefix}-N`
 * suffix given the collection's current ids. A pure function of
 * `existingIds` — never a module-global counter, so the same input always
 * produces the same result (spec §2).
 */
export const nextAvailableId = (prefix: string, existingIds: Iterable<string>): string => {
  const used = new Set(existingIds);
  let counter = 1;
  while (used.has(`${prefix}-${counter}`)) {
    counter += 1;
  }
  return `${prefix}-${counter}`;
};
