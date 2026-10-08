import { describe, expect, it } from 'vitest';
import { parseSetupConnections } from './setupConnections';

describe('parseSetupConnections', () => {
  it('keeps only supported connection fields and ignores credentials', () => {
    const connections = parseSetupConnections(
      JSON.stringify({
        network: 'media-net',
        connections: [
          {
            id: 'radarr',
            hostname: 'radarr',
            port: 7878,
            state: 'running',
            apiKey: 'must-not-be-imported',
          },
        ],
      })
    );

    expect(connections).toEqual([
      {
        id: 'radarr',
        hostname: 'radarr',
        port: 7878,
        state: 'running',
      },
    ]);
  });

  it('prefills duplicate providers with separate suggestions', () => {
    const connections = parseSetupConnections(
      JSON.stringify({
        connections: [
          { id: 'radarr', hostname: 'radarr-hd', port: 7878 },
          { id: 'radarr', hostname: 'radarr-4k', port: 7879 },
        ],
      })
    );

    expect(connections).toHaveLength(2);
    expect(connections.map(({ hostname }) => hostname)).toEqual([
      'radarr-hd',
      'radarr-4k',
    ]);
  });

  it('rejects malformed, oversized, and unsupported reports', () => {
    expect(() => parseSetupConnections('{')).toThrow(/valid.*JSON/i);
    expect(() => parseSetupConnections(' '.repeat(256 * 1024 + 1))).toThrow(
      /larger than 256 KB/
    );
    expect(() =>
      parseSetupConnections(
        JSON.stringify({
          connections: [
            {
              id: 'radarr',
              hostname: 'radarr; rm -rf /',
              port: 7878,
            },
          ],
        })
      )
    ).toThrow(/No supported app connection/);
    expect(() =>
      parseSetupConnections(
        JSON.stringify({
          connections: [
            { id: 'qbittorrent', hostname: 'qbittorrent', port: 8080 },
          ],
        })
      )
    ).toThrow(/No supported app connection/);
  });
});
