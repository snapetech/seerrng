// Share poster sizes with the client and cache warmers so navigation can reuse
// the same uncropped artwork before requesting a higher-resolution variant.
export const TMDB_POSTER_WIDTHS = [342, 500, 780] as const;
export const TMDB_POSTER_BASE_SIZE = `w${TMDB_POSTER_WIDTHS[0]}`;
