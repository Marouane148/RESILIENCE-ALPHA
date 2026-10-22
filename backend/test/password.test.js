import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { dashboardPassword, dashboardUser, labToken, startAuthServer } from './helpers.js';

describe('authentification par identifiant et mot de passe (mode par défaut)', () => {
  let ctx;
  let session;

  before(async () => { ctx = await startAuthServer({ mode: 'password' }); });
  after(async () => { await ctx.close(); });

  it('annonce le mode de connexion sans authentification', async () => {
    const { status, json } = await ctx.call('/auth/config', null, null, 'GET');
    assert.equal(status, 200);
    assert.equal(json.mode, 'password');
  });

  it('refuse les routes métier sans session', async () => {
    assert.equal((await ctx.call('/payments', null, null, 'GET')).status, 401);
  });

  it('ouvre une session avec les bons identifiants', async () => {
    const result = await ctx.call('/auth/password/login', { username: dashboardUser, password: dashboardPassword });
    assert.equal(result.status, 200);
    assert.equal(result.json.username, dashboardUser);
    session = result.json;
    assert.ok(session.token);
    assert.ok(ctx.events.accepted.includes('password_login_success'));
  });

  it('accepte la session pour les routes métier et le jeton de laboratoire', async () => {
    assert.equal((await ctx.call('/payments', null, session.token, 'GET')).status, 200);
    assert.equal((await ctx.call('/payments', null, labToken, 'GET')).status, 200);
  });

  it('rejette une session falsifiée', async () => {
    assert.equal((await ctx.call('/payments', null, `${session.token.slice(0, -2)}xx`, 'GET')).status, 401);
  });

  it('désactive les routes WebAuthn en mode mot de passe', async () => {
    assert.equal((await ctx.call('/auth/login/options', {})).status, 404);
    assert.equal((await ctx.call('/auth/register/options', { username: 'x' }, labToken)).status, 404);
  });

  it('refuse les mauvais identifiants, sans distinguer le nom du mot de passe', async () => {
    const badPassword = await ctx.call('/auth/password/login', { username: dashboardUser, password: 'faux' });
    const badUser = await ctx.call('/auth/password/login', { username: 'inconnu', password: dashboardPassword });
    assert.equal(badPassword.status, 401);
    assert.equal(badUser.status, 401);
    assert.deepEqual(badPassword.json, badUser.json);
  });

  it('refuse un corps invalide', async () => {
    assert.equal((await ctx.call('/auth/password/login', { username: dashboardUser })).status, 401);
    assert.equal((await ctx.call('/auth/password/login', { username: 1, password: 2 })).status, 401);
  });

  it('bloque la source après 5 échecs en une minute, puis journalise le blocage', async () => {
    const blocker = await startAuthServer({ mode: 'password' });
    try {
      for (let i = 0; i < 5; i += 1) {
        assert.equal((await blocker.call('/auth/password/login', { username: dashboardUser, password: `faux-${i}` })).status, 401);
      }
      const blocked = await blocker.call('/auth/password/login', { username: dashboardUser, password: dashboardPassword });
      assert.equal(blocked.status, 429);
      assert.ok(blocker.events.rejected.includes('password_blocked'));
      assert.equal(blocker.events.rejected.filter((reason) => reason === 'password_failed').length, 5);
    } finally {
      await blocker.close();
    }
  });
});
