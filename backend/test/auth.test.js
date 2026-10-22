import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createVirtualAuthenticator, labToken, startAuthServer } from './helpers.js';

describe('authentification WebAuthn (Face ID)', () => {
  let ctx;
  const device = createVirtualAuthenticator();
  let session;

  before(async () => { ctx = await startAuthServer({ mode: 'webauthn' }); });
  after(async () => { await ctx.close(); });

  it('refuse les routes métier et l’enrôlement sans jeton', async () => {
    assert.equal((await ctx.call('/payments', null, null, 'GET')).status, 401);
    assert.equal((await ctx.call('/auth/register/options', { username: 'riad' })).status, 401);
  });

  it('exige la vérification utilisateur et un authentificateur de plateforme à l’enrôlement', async () => {
    const { status, json } = await ctx.call('/auth/register/options', { username: 'riad' }, labToken);
    assert.equal(status, 200);
    assert.equal(json.options.authenticatorSelection.userVerification, 'required');
    assert.equal(json.options.authenticatorSelection.authenticatorAttachment, 'platform');

    const verified = await ctx.call(
      '/auth/register/verify',
      { challengeId: json.challengeId, response: device.register(json.options.challenge) },
      labToken,
    );
    assert.equal(verified.status, 201);
    session = verified.json;
    assert.ok(session.token);
  });

  it('accepte la session émise pour les routes métier', async () => {
    assert.equal((await ctx.call('/payments', null, session.token, 'GET')).status, 200);
    assert.equal((await ctx.call('/auth/session', null, session.token, 'GET')).json.username, 'riad');
  });

  it('rejette un jeton de session falsifié', async () => {
    const forged = `${session.token.slice(0, -2)}xx`;
    assert.equal((await ctx.call('/payments', null, forged, 'GET')).status, 401);
  });

  it('connecte l’utilisateur avec une assertion valide', async () => {
    const { json } = await ctx.call('/auth/login/options', {});
    assert.equal(json.options.userVerification, 'required');
    const result = await ctx.call('/auth/login/verify', { challengeId: json.challengeId, response: device.assert(json.options.challenge, 1) });
    assert.equal(result.status, 200);
    assert.equal(result.json.username, 'riad');
  });

  it('rejette le rejeu d’un challenge', async () => {
    const { json } = await ctx.call('/auth/login/options', {});
    const response = device.assert(json.options.challenge, 2);
    assert.equal((await ctx.call('/auth/login/verify', { challengeId: json.challengeId, response })).status, 200);
    assert.equal((await ctx.call('/auth/login/verify', { challengeId: json.challengeId, response })).status, 401);
  });

  it('rejette une assertion sans vérification utilisateur', async () => {
    const { json } = await ctx.call('/auth/login/options', {});
    const result = await ctx.call('/auth/login/verify', { challengeId: json.challengeId, response: device.assert(json.options.challenge, 9, 0x01) });
    assert.equal(result.status, 401);
  });

  it('rejette un compteur non croissant (clé clonée)', async () => {
    const { json } = await ctx.call('/auth/login/options', {});
    const result = await ctx.call('/auth/login/verify', { challengeId: json.challengeId, response: device.assert(json.options.challenge, 1) });
    assert.equal(result.status, 401);
  });

  it('journalise les échecs et les succès pour la supervision', () => {
    assert.ok(ctx.events.rejected.length >= 3);
    assert.ok(ctx.events.accepted.includes('register_success'));
    assert.ok(ctx.events.accepted.includes('login_success'));
  });
});
