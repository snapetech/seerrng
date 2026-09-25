import { MediaType } from '@server/constants/media';
import {
  isValidExternalMediaId,
  isValidMusicBrainzResourceId,
  isValidOpenLibraryResourceId,
  normalizeMusicBrainzId,
  normalizeOpenLibraryWorkId,
} from '@server/lib/externalIds';
import { normalizeMagazineTitle } from '@server/lib/magazineIdentity';
import { z } from 'zod';

const maxWatchlistId = 1_000_000_000;
const maxWatchlistTextLength = 512;

const strictPositiveInteger = z.preprocess(
  (value) =>
    typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value,
  z.number().int().positive().max(maxWatchlistId)
);

export const watchlistCreate = z
  .object({
    ratingKey: z.string().trim().min(1).max(maxWatchlistTextLength).optional(),
    tmdbId: strictPositiveInteger.optional(),
    mbId: z
      .string()
      .trim()
      .min(1)
      .max(maxWatchlistTextLength)
      .refine((value) =>
        isValidMusicBrainzResourceId(normalizeMusicBrainzId(value))
      )
      .optional(),
    externalId: z.string().trim().min(1).max(maxWatchlistTextLength).optional(),
    mediaType: z.nativeEnum(MediaType),
    title: z.string().trim().max(maxWatchlistTextLength).optional(),
  })
  .superRefine((value, context) => {
    if (
      value.mediaType === MediaType.MOVIE ||
      value.mediaType === MediaType.TV
    ) {
      if (!value.tmdbId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'TMDB ID is required.',
        });
      }
      return;
    }

    if (value.mediaType === MediaType.MUSIC) {
      if (
        !value.mbId ||
        !isValidMusicBrainzResourceId(normalizeMusicBrainzId(value.mbId))
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'MusicBrainz ID is invalid.',
        });
      }
      return;
    }

    if (value.mediaType === MediaType.BOOK) {
      if (
        !value.externalId ||
        !isValidOpenLibraryResourceId(
          normalizeOpenLibraryWorkId(value.externalId)
        )
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Open Library ID is invalid.',
        });
      }
      return;
    }

    if (value.mediaType === MediaType.COMIC) {
      if (
        !value.externalId ||
        !isValidExternalMediaId(value.externalId, MediaType.COMIC)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'ComicVine ID is invalid.',
        });
      }
      return;
    }

    if (
      value.mediaType === MediaType.MAGAZINE &&
      (!value.externalId ||
        value.externalId.length > 256 ||
        !normalizeMagazineTitle(value.externalId))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Magazine title is invalid.',
      });
    }
  });
