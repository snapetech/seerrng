const LEAGUE_ID_PATTERN = /^lg-(\d{6,})$/;
const MIN_LEAGUE_ALIAS = 900_000_000;
const MAX_LEAGUE_ALIAS = 999_999_999;

/** Sportarr's Sonarr compatibility API uses this range as a league alias. */
export const getSportarrLeagueAlias = (
  externalId: string
): number | undefined => {
  const match = LEAGUE_ID_PATTERN.exec(externalId.trim());
  if (!match) return undefined;

  const id = Number(match[1]);
  const alias = id + MIN_LEAGUE_ALIAS;
  return Number.isSafeInteger(id) && id > 0 && alias <= MAX_LEAGUE_ALIAS
    ? alias
    : undefined;
};

/** Convert a Sportarr-only numeric compatibility alias to its stable league ID. */
export const getSportarrLeagueExternalId = (
  alias: number
): string | undefined => {
  if (
    !Number.isSafeInteger(alias) ||
    alias < MIN_LEAGUE_ALIAS ||
    alias > MAX_LEAGUE_ALIAS
  ) {
    return undefined;
  }

  const id = alias - MIN_LEAGUE_ALIAS;
  return id > 0 ? `lg-${String(id).padStart(6, '0')}` : undefined;
};

export const isSportarrLeagueExternalId = (value: unknown): value is string =>
  typeof value === 'string' && getSportarrLeagueAlias(value) !== undefined;
