import useSWR from 'swr';

export interface LiveTvStatus {
  configured: boolean;
  guideReady: boolean;
  canRequest: boolean;
  guide?: {
    ready: boolean;
    refreshedAt?: string;
    programmeCount: number;
    channelCount: number;
    truncated: boolean;
    lastError?: string;
  };
}

export interface LiveTvAiring {
  channel: string;
  channelName: string;
  start: string;
  stop: string;
  title: string;
  subTitle?: string;
  season?: number;
  episode?: number;
  categories: string[];
}

export type RecordingStatus =
  | 'pending'
  | 'scheduled'
  | 'recording'
  | 'completed'
  | 'failed'
  | 'declined'
  | 'cancelled';

export interface RecordingRequestView {
  id: number;
  kind: 'airing' | 'series';
  status: RecordingStatus;
  title: string;
  subTitle?: string;
  mediaType?: 'movie' | 'tv';
  tmdbId?: number;
  channel?: string;
  channelName?: string;
  startsAt?: string;
  endsAt?: string;
  completedCount: number;
  failedCount: number;
  lastError?: string;
  createdAt: string;
  requestedBy?: { id: number; displayName: string };
}

export const useLiveTvStatus = () =>
  useSWR<LiveTvStatus>('/api/v1/live-tv/status', {
    revalidateOnFocus: false,
    dedupingInterval: 60_000,
  });

export const liveTvAiringsKey = (titles: string[], limit = 10) => {
  const unique = [...new Set(titles.map((title) => title.trim()))].filter(
    Boolean
  );
  if (unique.length === 0) return null;
  const query = unique
    .slice(0, 4)
    .map((title) => `title=${encodeURIComponent(title)}`)
    .join('&');
  return `/api/v1/live-tv/airings?${query}&limit=${limit}`;
};
