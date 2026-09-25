import type {
  ComicVineIssueSummary,
  ComicVineVolumeDetails,
  ComicVineVolumeResult,
} from '@server/api/comicvine';
import type Media from '@server/entity/Media';

export interface ComicResult {
  id: string;
  provider: 'comicvine';
  mediaType: 'comic';
  title: string;
  aliases?: string[];
  publisher?: string;
  startYear?: string;
  issueCount?: number;
  posterPath?: string;
  deck?: string;
  siteDetailUrl?: string;
  mediaInfo?: Media;
}

export interface ComicIssueReference {
  id: string;
  name?: string;
  issueNumber?: string;
}

export interface ComicDetails extends ComicResult {
  description?: string;
  issues?: ComicIssueReference[];
  onUserWatchlist?: boolean;
}

const pickPosterPath = (
  image: ComicVineVolumeResult['image']
): string | undefined =>
  image?.super_url ?? image?.medium_url ?? image?.small_url ?? image?.icon_url;

const mapIssueSummary = (
  issue: ComicVineIssueSummary
): ComicIssueReference => ({
  id: String(issue.id),
  name: issue.name,
  issueNumber: issue.issue_number,
});

export const mapComicVineVolumeResult = (
  volume: ComicVineVolumeResult,
  media?: Media
): ComicResult => ({
  id: String(volume.id),
  provider: 'comicvine',
  mediaType: 'comic',
  title: volume.name,
  aliases: volume.aliases,
  publisher: volume.publisher?.name,
  startYear: volume.start_year,
  issueCount: volume.count_of_issues,
  posterPath: pickPosterPath(volume.image),
  deck: volume.deck,
  siteDetailUrl: volume.site_detail_url,
  mediaInfo: media,
});

export const mapComicVineVolumeDetails = (
  volume: ComicVineVolumeDetails,
  media?: Media,
  onUserWatchlist?: boolean
): ComicDetails => ({
  ...mapComicVineVolumeResult(volume, media),
  description: volume.description,
  issues: volume.issues?.map(mapIssueSummary),
  onUserWatchlist,
});
