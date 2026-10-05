export interface CatalogPlatformLabel {
  id: number;
  name: string;
}

export interface RomarrPlatformLabels {
  slug: string;
  name: string;
  aliases?: string[];
}

export const normalizeCatalogPlatformName = (value: string): string =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export const getCatalogPlatformCandidates = (
  system: RomarrPlatformLabels,
  platforms: CatalogPlatformLabel[]
): CatalogPlatformLabel[] => {
  const names = new Set(
    [system.name, system.slug, ...(system.aliases ?? [])]
      .map(normalizeCatalogPlatformName)
      .filter(Boolean)
  );
  return platforms.filter((platform) =>
    names.has(normalizeCatalogPlatformName(platform.name))
  );
};

/** Automatic mapping is only safe when aliases resolve to one catalog ID. */
export const getAutomaticCatalogPlatform = (
  system: RomarrPlatformLabels,
  platforms: CatalogPlatformLabel[]
): CatalogPlatformLabel | undefined => {
  const candidates = getCatalogPlatformCandidates(system, platforms);
  const unique = [
    ...new Map(candidates.map((item) => [item.id, item])).values(),
  ];
  return unique.length === 1 ? unique[0] : undefined;
};
