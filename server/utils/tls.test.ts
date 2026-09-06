import assert from 'node:assert/strict';
import { X509Certificate } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  buildHttpsRedirectLocation,
  initializeTls,
  parseTlsBoolean,
  parseTlsHosts,
  parseTlsMode,
} from './tls';

describe('TLS configuration parsing', () => {
  it('keeps TLS disabled unless explicitly enabled', () => {
    assert.equal(parseTlsMode(), 'disabled');
    assert.equal(parseTlsMode('SELF-SIGNED'), 'self-signed');
    assert.equal(parseTlsMode('provided'), 'provided');
    assert.deepEqual(parseTlsHosts('localhost, 127.0.0.1, ::1'), [
      'localhost',
      '127.0.0.1',
      '::1',
    ]);
    assert.equal(parseTlsBoolean('FLAG', undefined), false);
    assert.equal(parseTlsBoolean('FLAG', '1'), true);
    assert.throws(() => parseTlsMode('automatic'), /SEERR_TLS_MODE/);
    assert.throws(() => parseTlsBoolean('FLAG', 'yes'), /true.*false/);
  });

  it('rejects redirect hosts that are not explicitly in the TLS SAN list', () => {
    assert.equal(
      buildHttpsRedirectLocation(
        { headers: { host: 'server.example:5055' }, url: '/login?next=1' },
        5056,
        ['server.example']
      ),
      'https://server.example:5056/login?next=1'
    );
    assert.equal(
      buildHttpsRedirectLocation(
        { headers: { host: 'attacker.example:5055' }, url: '/' },
        5056,
        ['server.example']
      ),
      undefined
    );
    assert.equal(
      buildHttpsRedirectLocation(
        { headers: { host: '[::1]:5055' }, url: '/api/v1/status/ready' },
        5056,
        ['::1']
      ),
      'https://[::1]:5056/api/v1/status/ready'
    );
    assert.equal(
      buildHttpsRedirectLocation(
        {
          headers: { host: 'server.example:5055' },
          url: '//attacker.example/',
        },
        5056,
        ['server.example']
      ),
      undefined
    );
  });
});

describe('built-in local TLS material', () => {
  it('generates persistent CA and server material and refreshes changed SANs', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'seerrng-tls-'));
    try {
      const environment = {
        ...process.env,
        SEERR_TLS_MODE: 'self-signed',
        SEERR_TLS_HOSTS: 'localhost,127.0.0.1',
      };
      const first = await initializeTls({
        httpPort: 5055,
        httpsPort: 5056,
        tlsDirectory: directory,
        environment,
      });
      assert.equal(first.runtime.mode, 'self-signed');
      assert.equal(first.runtime.caDownloadAvailable, true);
      assert.deepEqual(first.hosts, ['localhost', '127.0.0.1']);
      assert.ok(first.runtime.fingerprint);

      for (const file of ['ca.crt', 'ca.key', 'server.crt', 'server.key']) {
        const stat = await fs.stat(path.join(directory, file));
        assert.equal(stat.isFile(), true);
        assert.equal(stat.mode & 0o077, 0);
      }

      const caCertificate = new X509Certificate(
        await fs.readFile(path.join(directory, 'ca.crt'), 'utf8')
      );
      const serverCertificate = new X509Certificate(
        await fs.readFile(path.join(directory, 'server.crt'), 'utf8')
      );
      assert.equal(serverCertificate.checkIssued(caCertificate), true);

      const second = await initializeTls({
        httpPort: 5055,
        httpsPort: 5056,
        tlsDirectory: directory,
        environment,
      });
      assert.equal(second.runtime.fingerprint, first.runtime.fingerprint);

      const changed = await initializeTls({
        httpPort: 5055,
        httpsPort: 5056,
        tlsDirectory: directory,
        environment: {
          ...process.env,
          ...environment,
          SEERR_TLS_HOSTS: 'localhost,127.0.0.1,seerr.local',
        },
      });
      assert.notEqual(changed.runtime.fingerprint, first.runtime.fingerprint);
      assert.deepEqual(changed.hosts, [
        'localhost',
        '127.0.0.1',
        'seerr.local',
      ]);

      const provided = await initializeTls({
        httpPort: 5055,
        httpsPort: 5056,
        environment: {
          ...process.env,
          SEERR_TLS_MODE: 'provided',
          SEERR_TLS_CERT_FILE: path.join(directory, 'server.crt'),
          SEERR_TLS_KEY_FILE: path.join(directory, 'server.key'),
        },
      });
      assert.equal(provided.runtime.mode, 'provided');
      assert.equal(provided.runtime.fingerprint, changed.runtime.fingerprint);
      assert.deepEqual(provided.hosts, [
        'localhost',
        '127.0.0.1',
        'seerr.local',
      ]);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it('fails closed when the explicit HTTP fallback conflicts with TLS', async () => {
    await assert.rejects(
      initializeTls({
        httpPort: 5055,
        httpsPort: 5056,
        environment: {
          ...process.env,
          SEERR_TLS_MODE: 'self-signed',
          SEERR_ALLOW_HTTP_AUTH: 'true',
        },
      }),
      /cannot be enabled together/i
    );
  });
});
