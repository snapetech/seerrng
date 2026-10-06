import DelugeClient from '@server/api/downloadClients/deluge';
import QBittorrentClient from '@server/api/downloadClients/qbittorrent';
import TorrentNGClient from '@server/api/downloadClients/torrentng';
import TransmissionClient from '@server/api/downloadClients/transmission';
import type { DownloadClientAdapter } from '@server/api/downloadClients/types';
import type { DownloadClientSettings } from '@server/lib/settings';

export const createDownloadClient = (
  settings: DownloadClientSettings
): DownloadClientAdapter => {
  switch (settings.type) {
    case 'qbittorrent':
      return new QBittorrentClient(settings);
    case 'transmission':
      return new TransmissionClient(settings);
    case 'deluge':
      return new DelugeClient(settings);
    case 'torrentng':
      return new TorrentNGClient(settings);
  }
};
