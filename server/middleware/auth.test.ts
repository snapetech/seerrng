import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { it } from 'node:test';

import { Permission } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import {
  runAuthorizedUserSecurityMutation,
  UserMutationActorUnauthorizedError,
} from '@server/lib/userSecurityMutation';
import { setupTestDb } from '@server/test/db';
import type { NextFunction, Request, Response } from 'express';
import { checkUser } from './auth';

setupTestDb();

it('propagates API key rotation authority into admitted mutations', async () => {
  const settings = getSettings();
  settings.main.apiKey = 'initial-service-api-key';
  const request = {
    header: (name: string) =>
      name === 'X-API-Key' ? 'initial-service-api-key' : undefined,
    headers: {},
  } as unknown as Request;
  const response = new EventEmitter() as Response & EventEmitter;
  let mutation: Promise<void> | undefined;

  await new Promise<void>((resolve, reject) => {
    void checkUser(request, response, ((error?: unknown) => {
      if (error) {
        reject(error);
        return;
      }

      settings.main.apiKey = 'rotated-service-api-key';
      mutation = runAuthorizedUserSecurityMutation(
        1,
        1,
        Permission.ADMIN,
        async () => undefined
      );
      resolve();
    }) as NextFunction);
  });

  assert.ok(mutation);
  await assert.rejects(mutation, UserMutationActorUnauthorizedError);
  response.emit('finish');
});
