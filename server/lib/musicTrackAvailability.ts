import LidarrAPI from '@server/api/servarr/lidarr';
import {
  isValidMusicBrainzResourceId,
  normalizeMusicBrainzId,
} from '@server/lib/externalIds';
import { runWithServarrServiceSnapshot } from '@server/lib/serviceAdmission';
import type { LidarrSettings } from '@server/lib/settings';

export type MusicTrackQuality = 'mp3' | 'flac';

export interface MusicTrackAvailability {
  mp3?: string[];
  flac?: string[];
}

const getQuality = (
  service: Pick<LidarrSettings, 'activeProfileName' | 'name'>
): MusicTrackQuality | undefined => {
  const label = `${service.activeProfileName} ${service.name}`.toUpperCase();
  if (label.includes('FLAC')) return 'flac';
  if (label.includes('MP3')) return 'mp3';
  return undefined;
};

export type MusicTrackAvailabilityLoader = (
  mbId: string,
  service: LidarrSettings
) => Promise<string[]>;

const loadAvailableRecordings: MusicTrackAvailabilityLoader = async (
  mbId: string,
  service: LidarrSettings
): Promise<string[]> =>
  runWithServarrServiceSnapshot('lidarr', service, async (currentService) => {
    const api = new LidarrAPI({
      apiKey: currentService.apiKey,
      url: LidarrAPI.buildUrl(currentService, '/api/v1'),
    });
    const albums = await api.getAlbums(300);
    const album = albums.find(
      (candidate) =>
        normalizeMusicBrainzId(candidate.foreignAlbumId || candidate.mbId) ===
        mbId
    );
    if (!album) return [];

    const tracks = await api.getTracks({ albumId: album.id }, 300);
    return [
      ...new Set(
        tracks
          .filter((track) => track.hasFile)
          .map((track) => normalizeMusicBrainzId(track.foreignRecordingId))
          .filter(isValidMusicBrainzResourceId)
      ),
    ];
  });

export const getMusicTrackAvailability = async (
  albumMbId: string,
  services: LidarrSettings[],
  loadRecordings: MusicTrackAvailabilityLoader = loadAvailableRecordings
): Promise<MusicTrackAvailability> => {
  const mbId = normalizeMusicBrainzId(albumMbId);
  const candidates = services.flatMap((service) => {
    const quality = getQuality(service);
    return quality ? [{ quality, service }] : [];
  });
  const results = await Promise.allSettled(
    candidates.map(async ({ quality, service }) => ({
      quality,
      recordingIds: await loadRecordings(mbId, service),
    }))
  );
  const availability: MusicTrackAvailability = {};

  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    const existing = availability[result.value.quality] ?? [];
    const recordingIds = result.value.recordingIds
      .map(normalizeMusicBrainzId)
      .filter(isValidMusicBrainzResourceId);
    availability[result.value.quality] = [
      ...new Set([...existing, ...recordingIds]),
    ];
  }

  return availability;
};
