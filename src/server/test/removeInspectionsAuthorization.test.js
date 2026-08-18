/**
 * Testes de autorização da rota GET /service/campaign/removeInspections.
 *
 * Contexto (2026-08-18): o botão "Remover" da tela /supervisor
 * (views/supervisor.tpl.html) parou de funcionar após o commit 7345373
 * (2026-05-09), que protegeu a rota com um middleware exigindo
 * `session.admin.superAdmin`. Essa flag só é criada pelo login do painel
 * administrativo (controllers/campaign-crud.js). O login do TVI
 * (controllers/login.js) cria apenas `session.user`, com
 * `type === 'supervisor'`. Resultado: a tela do supervisor recebia HTTP 401
 * e, como `requester._get` descarta erros quando o callback não expõe
 * `.error`, nenhuma mensagem chegava ao usuário.
 *
 * Estes testes exercitam a cadeia de middlewares realmente registrada em
 * routes/supervisor.js, sem Mongo e sem subir o Express.
 *
 * Execução:
 *   cd src/server && npm test
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const supervisorRoutes = require(path.join(__dirname, '..', 'routes', 'supervisor'));

const ROUTE = '/service/campaign/removeInspections';

// Carrega routes/supervisor.js com um `app` falso que apenas registra as rotas,
// e devolve a cadeia de middlewares associada ao caminho pedido.
function middlewaresFor(routePath) {
    const registered = [];
    const fakeApp = {
        controllers: { supervisor: new Proxy({}, { get: () => function handlerStub() {} }) },
        get: function (p) {
            registered.push({ path: p, chain: Array.prototype.slice.call(arguments, 1) });
        },
        post: function () {},
        put: function () {},
        delete: function () {}
    };
    supervisorRoutes(fakeApp);
    const entry = registered.find(r => r.path === routePath);
    assert.ok(entry, 'rota ' + routePath + ' não registrada');
    // O último elemento é o handler do controller; os anteriores são guardas.
    return entry.chain.slice(0, -1);
}

// Executa a cadeia de guardas e informa se a requisição chegaria ao handler.
function runGuards(guards, session) {
    let status = null;
    let body = null;
    let reachedHandler = false;
    const req = { session: session, sessionID: 'sid-teste', ip: '127.0.0.1' };
    const res = {
        status: function (code) { status = code; return res; },
        json: function (payload) { body = payload; return res; },
        send: function (payload) { body = payload; return res; }
    };

    const step = function (i) {
        if (i >= guards.length) { reachedHandler = true; return; }
        guards[i](req, res, function () { step(i + 1); });
    };
    step(0);

    return { authorized: reachedHandler, status: status, body: body };
}

test('supervisor logado no TVI é autorizado a remover inspeções', () => {
    const guards = middlewaresFor(ROUTE);
    const result = runGuards(guards, {
        user: { name: 'admin', type: 'supervisor', campaign: { _id: 'campanha-1' } }
    });
    assert.equal(result.authorized, true, 'sessão de supervisor deveria alcançar o handler; recebeu status ' + result.status);
});

test('super-admin do painel administrativo continua autorizado', () => {
    const guards = middlewaresFor(ROUTE);
    const result = runGuards(guards, {
        admin: { superAdmin: { id: 'admin', username: 'admin' } }
    });
    assert.equal(result.authorized, true);
});

test('inspetor comum é rejeitado com 401', () => {
    const guards = middlewaresFor(ROUTE);
    const result = runGuards(guards, {
        user: { name: 'joao', type: 'inspector', campaign: { _id: 'campanha-1' } }
    });
    assert.equal(result.authorized, false);
    assert.equal(result.status, 401);
});

test('requisição sem sessão é rejeitada com 401', () => {
    const guards = middlewaresFor(ROUTE);
    const result = runGuards(guards, {});
    assert.equal(result.authorized, false);
    assert.equal(result.status, 401);
});
