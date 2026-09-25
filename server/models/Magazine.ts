import type {
  LazyLibrarianIssue,
  LazyLibrarianMagazine,
} from '@server/api/lazylibrarian';
import type Media from '@server/entity/Media';
import { normalizeMagazineTitle } from '@server/lib/magazineIdentity';

export interface MagazineResult {
  id: string;
  provider: 'lazylibrarian';
  mediaType: 'magazine';
  title: string;
  posterPath?: string;
  backdropPath?: string;
  status?: string;
  latestIssue?: string;
  issueCount?: number;
  mediaInfo?: Media;
}

export interface MagazineIssueReference {
  id: string;
  date?: string;
  available: boolean;
}

export interface MagazineDetails extends MagazineResult {
  issues: MagazineIssueReference[];
  onUserWatchlist?: boolean;
}

const getMagazinePosterPath = (
  magazine: LazyLibrarianMagazine,
  serviceId?: number
): string | undefined => {
  const coverId = magazine.latestCover?.match(
    /^cache\/magazine\/([a-f\d]{32}|[a-f\d]{40})\.jpg$/i
  )?.[1];

  if (!serviceId || !Number.isSafeInteger(serviceId) || !coverId) {
    return undefined;
  }

  return `/api/v1/magazine/cover/${serviceId}/${coverId.toLowerCase()}`;
};

export const mapLazyLibrarianMagazine = (
  magazine: LazyLibrarianMagazine,
  issues: LazyLibrarianIssue[] = [],
  media?: Media,
  serviceId?: number
): MagazineResult => ({
  id: magazine.title,
  provider: 'lazylibrarian',
  mediaType: 'magazine',
  title: magazine.title,
  posterPath: getMagazinePosterPath(magazine, serviceId),
  status: magazine.status,
  latestIssue: magazine.issueDate,
  issueCount: issues.length,
  mediaInfo: media,
});

export const mapLazyLibrarianMagazineDetails = (
  magazine: LazyLibrarianMagazine,
  issues: LazyLibrarianIssue[],
  media?: Media,
  onUserWatchlist?: boolean,
  serviceId?: number
): MagazineDetails => ({
  ...mapLazyLibrarianMagazine(magazine, issues, media, serviceId),
  onUserWatchlist,
  issues: issues.map((issue) => ({
    id:
      issue.issueId ??
      [issue.issueNumber, issue.issueDate, issue.title]
        .filter(Boolean)
        .join('-')
        .slice(0, 128) ??
      normalizeMagazineTitle(issue.title),
    date: issue.issueDate,
    available: Boolean(issue.issueFile),
  })),
});
