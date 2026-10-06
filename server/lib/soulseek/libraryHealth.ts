import MusicBrainz from '@server/api/musicbrainz';
import SlskdnAPI, {
  type SlskdnLibraryIssue,
  type SlskdnSongIdRun,
} from '@server/api/slskdn';
import { getSettings } from '@server/lib/settings';
import { mapWithConcurrency } from '@server/utils/concurrency';

const OPEN_STATUSES = ['Detected', 'Acknowledged', 'Failed'];
const MAX_RELEASES_CHECKED = 25;

export interface AlbumIssueView {
  issueId: string;
  type: string;
  severity: string;
  status: string;
  title?: string;
  reason?: string;
  canAutoFix: boolean;
  remediationJobId?: string;
}

const toView = (issue: SlskdnLibraryIssue): AlbumIssueView => ({
  issueId: issue.issueId,
  type: String(issue.type),
  severity: String(issue.severity),
  status: String(issue.status),
  title: issue.title || undefined,
  reason: issue.reason?.slice(0, 300) || undefined,
  canAutoFix: issue.canAutoFix === true,
  remediationJobId: issue.remediationJobId || undefined,
});

/**
 * Open slskdN library-health issues for a SeerrNG album (a MusicBrainz
 * release group), found through each of its releases.
 */
export const getAlbumIssues = async (
  releaseGroupId: string
): Promise<AlbumIssueView[]> => {
  const details = await new MusicBrainz().getReleaseGroupDetails({
    releaseGroupId,
  });
  const releaseIds = (details.releases ?? [])
    .map((release) => release.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
    .slice(0, MAX_RELEASES_CHECKED);
  const api = new SlskdnAPI(getSettings().slskdn);
  const results = await mapWithConcurrency(releaseIds, 4, (releaseId) =>
    api.getLibraryIssues({
      musicBrainzReleaseId: releaseId,
      statuses: OPEN_STATUSES,
    })
  );
  const seen = new Set<string>();
  return results
    .flat()
    .filter((issue) => {
      if (!issue.issueId || seen.has(issue.issueId)) return false;
      seen.add(issue.issueId);
      return true;
    })
    .map(toView);
};

/** Starts remediation only for issues that belong to the album. */
export const remediateAlbumIssues = async (
  releaseGroupId: string,
  issueIds: string[]
): Promise<{ jobId: string; issueCount: number }> => {
  const albumIssues = await getAlbumIssues(releaseGroupId);
  const allowed = new Set(
    albumIssues
      .filter((issue) => issue.canAutoFix)
      .map((issue) => issue.issueId)
  );
  const selected = issueIds.filter((id) => allowed.has(id));
  if (selected.length === 0) {
    return { jobId: '', issueCount: 0 };
  }
  const jobId = await new SlskdnAPI(getSettings().slskdn).remediateIssues(
    selected
  );
  return { jobId, issueCount: selected.length };
};

export interface SongIdView {
  id: string;
  status: string;
  summary?: string;
  stage?: string;
  percentComplete?: number;
  queuePosition?: number;
  albums: {
    releaseId: string;
    releaseGroupId?: string;
    title: string;
    artist: string;
    isExact: boolean;
  }[];
  tracks: {
    recordingId: string;
    title: string;
    artist: string;
    isExact: boolean;
  }[];
}

/**
 * Shapes a SongID run for SeerrNG. Album candidates are resolved to release
 * groups so the UI can link to SeerrNG album pages.
 */
export const toSongIdView = async (
  run: SlskdnSongIdRun,
  resolveReleaseGroup: (releaseId: string) => Promise<string | null> = (
    releaseId
  ) => new MusicBrainz().getReleaseGroup({ releaseId })
): Promise<SongIdView> => {
  const albums = await mapWithConcurrency(
    (run.albums ?? []).filter((album) => album.releaseId).slice(0, 5),
    2,
    async (album) => ({
      releaseId: album.releaseId,
      releaseGroupId:
        (await resolveReleaseGroup(album.releaseId).catch(() => null)) ??
        undefined,
      title: album.title,
      artist: album.artist,
      isExact: album.isExact === true,
    })
  );
  return {
    id: run.id,
    status: run.status,
    summary: run.summary?.slice(0, 500) || undefined,
    stage: run.currentStage || undefined,
    percentComplete:
      typeof run.percentComplete === 'number' ? run.percentComplete : undefined,
    queuePosition:
      typeof run.queuePosition === 'number' ? run.queuePosition : undefined,
    albums,
    tracks: (run.tracks ?? []).slice(0, 10).map((track) => ({
      recordingId: track.recordingId,
      title: track.title,
      artist: track.artist,
      isExact: track.isExact === true,
    })),
  };
};
