/**
 * Testes da marcação de dúvida pelo supervisor.
 *
 * Cobre as duas metades da entrega:
 *   - util/doubtSupervisorMark — derivação do rótulo e mutação de cada
 *     marcação (puro, sem Mongo).
 *   - routes/doubts — autorização da rota nova: supervisor da campanha pode
 *     marcar; inspetor e sessão ausente não podem. O escopo por campanha em si
 *     é aplicado no controller e verificado por leitura, não aqui.
 *
 * Execução: `cd src/server && npm test`.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
    NAO_VISTO,
    RESOLVIDO,
    EXEMPLO,
    VALID_MARKS,
    deriveMark,
    buildMarkUpdate
} = require('../util/doubtSupervisorMark');

const AGORA = new Date('2026-08-18T12:00:00Z');
const SUPERVISOR = 'supervisor-teste';

// --------------------------------------------------------------------------
// deriveMark
// --------------------------------------------------------------------------

test('deriveMark lê "não visto" de uma dúvida aberta', () => {
    assert.equal(deriveMark({ status: 'ABERTA' }), NAO_VISTO);
    // Documentos anteriores a esta entrega não têm o campo `example`.
    assert.equal(deriveMark({ status: 'ABERTA', example: undefined }), NAO_VISTO);
});

test('deriveMark lê "resolvido" de uma dúvida resolvida', () => {
    assert.equal(deriveMark({ status: 'RESOLVIDA' }), RESOLVIDO);
});

test('deriveMark reflete resolução feita fora da tela do supervisor', () => {
    // O rótulo é derivado justamente para acompanhar o super-admin que resolve
    // pelo painel administrativo, sem sincronização de um segundo campo.
    const doubt = { status: 'ABERTA' };
    assert.equal(deriveMark(doubt), NAO_VISTO);
    doubt.status = 'RESOLVIDA';
    assert.equal(deriveMark(doubt), RESOLVIDO);
});

test('deriveMark dá precedência ao exemplo sobre o status', () => {
    assert.equal(deriveMark({ status: 'ABERTA', example: true }), EXEMPLO);
    assert.equal(deriveMark({ status: 'RESOLVIDA', example: true }), EXEMPLO);
});

test('deriveMark devolve null quando o ponto não tem dúvida', () => {
    assert.equal(deriveMark(null), null);
    assert.equal(deriveMark(undefined), null);
});

// --------------------------------------------------------------------------
// buildMarkUpdate
// --------------------------------------------------------------------------

test('marcar como resolvido encerra a dúvida e registra quem resolveu', () => {
    const r = buildMarkUpdate({ status: 'ABERTA' }, RESOLVIDO, SUPERVISOR, AGORA);

    assert.equal(r.noop, false);
    assert.equal(r.setFields['doubt.status'], 'RESOLVIDA');
    assert.equal(r.setFields['doubt.resolvedBy'], SUPERVISOR);
    assert.equal(r.setFields['doubt.resolvedAt'], AGORA);
    assert.equal(r.resolved, true, 'a transição precisa sinalizar o disparo da notificação');
    assert.equal(r.historyEntry.from, 'ABERTA');
    assert.equal(r.historyEntry.to, 'RESOLVIDA');
    assert.equal(r.historyEntry.mark, RESOLVIDO);
    assert.equal(r.historyEntry.changedBy, SUPERVISOR);
});

test('marcar como não visto reabre a dúvida e limpa a resolução', () => {
    const r = buildMarkUpdate({ status: 'RESOLVIDA', resolvedBy: 'outro' }, NAO_VISTO, SUPERVISOR, AGORA);

    assert.equal(r.setFields['doubt.status'], 'ABERTA');
    assert.equal(r.setFields['doubt.resolvedBy'], null);
    assert.equal(r.setFields['doubt.resolvedAt'], null);
    assert.equal(r.resolved, false);
});

test('marcar como exemplo não altera o status da dúvida', () => {
    // Decisão registrada no desenho: "exemplo" é rótulo, sem efeito no ciclo.
    // A dúvida segue aberta e contando nos indicadores de pendências.
    const r = buildMarkUpdate({ status: 'ABERTA' }, EXEMPLO, SUPERVISOR, AGORA);

    assert.equal(r.setFields['doubt.example'], true);
    assert.equal(r.setFields['doubt.exampleBy'], SUPERVISOR);
    assert.equal(r.setFields['doubt.exampleAt'], AGORA);
    assert.equal(r.setFields['doubt.status'], undefined, 'exemplo não pode mexer no status');
    assert.equal(r.resolved, false);
    assert.equal(r.historyEntry.from, 'ABERTA');
    assert.equal(r.historyEntry.to, 'ABERTA');
    assert.equal(r.historyEntry.mark, EXEMPLO);
});

test('marcar como exemplo preserva a dúvida já resolvida', () => {
    const r = buildMarkUpdate({ status: 'RESOLVIDA' }, EXEMPLO, SUPERVISOR, AGORA);
    assert.equal(r.setFields['doubt.status'], undefined);
    assert.equal(r.historyEntry.to, 'RESOLVIDA');
});

test('resolvido e não visto retiram a marca de exemplo', () => {
    // Os três rótulos são exclusivos na tela; sair de "exemplo" precisa limpar
    // o campo, senão deriveMark continuaria devolvendo EXEMPLO.
    [RESOLVIDO, NAO_VISTO].forEach(function (mark) {
        const partida = mark === RESOLVIDO ? 'ABERTA' : 'RESOLVIDA';
        const r = buildMarkUpdate({ status: partida, example: true }, mark, SUPERVISOR, AGORA);
        assert.equal(r.setFields['doubt.example'], false);
        assert.equal(r.setFields['doubt.exampleBy'], null);
        assert.equal(r.setFields['doubt.exampleAt'], null);
    });
});

test('remarcar o rótulo atual é operação sem efeito', () => {
    assert.deepEqual(buildMarkUpdate({ status: 'ABERTA' }, NAO_VISTO, SUPERVISOR, AGORA), { noop: true });
    assert.deepEqual(buildMarkUpdate({ status: 'RESOLVIDA' }, RESOLVIDO, SUPERVISOR, AGORA), { noop: true });
    assert.deepEqual(buildMarkUpdate({ status: 'ABERTA', example: true }, EXEMPLO, SUPERVISOR, AGORA), { noop: true });
});

test('marcação desconhecida é recusada com status 400', () => {
    ['RESOLVIDA', 'resolvido', '', null, undefined].forEach(function (mark) {
        assert.throws(
            () => buildMarkUpdate({ status: 'ABERTA' }, mark, SUPERVISOR, AGORA),
            (err) => err.status === 400,
            'marcação ' + String(mark) + ' deveria ser recusada'
        );
    });
    assert.deepEqual(VALID_MARKS, [NAO_VISTO, RESOLVIDO, EXEMPLO]);
});

test('ponto sem dúvida é recusado com status 404', () => {
    assert.throws(() => buildMarkUpdate(null, RESOLVIDO, SUPERVISOR, AGORA), (err) => err.status === 404);
});

// --------------------------------------------------------------------------
// Autorização da rota
// --------------------------------------------------------------------------

const ROTA = '/service/points/:pointId/doubt/supervisor-mark';

function middlewaresDaRota(routePath, metodo) {
    const registradas = [];
    const capturar = function (m) {
        return function (p) {
            registradas.push({ metodo: m, path: p, chain: Array.prototype.slice.call(arguments, 1) });
        };
    };
    const fakeApp = {
        controllers: { doubts: new Proxy({}, { get: () => function () {} }) },
        services: { logger: null },
        get: capturar('get'),
        post: capturar('post'),
        put: capturar('put'),
        delete: capturar('delete')
    };
    require(path.join(__dirname, '..', 'routes', 'doubts'))(fakeApp);

    const entrada = registradas.find(r => r.path === routePath && r.metodo === metodo);
    assert.ok(entrada, 'rota ' + metodo.toUpperCase() + ' ' + routePath + ' não registrada');
    return entrada.chain.slice(0, -1);
}

function executarGuardas(guardas, session) {
    let status = null;
    let alcancouHandler = false;
    const req = { session: session, sessionID: 'sid', ip: '127.0.0.1' };
    const res = {
        status: function (code) { status = code; return res; },
        json: function () { return res; },
        send: function () { return res; }
    };
    const passo = function (i) {
        if (i >= guardas.length) { alcancouHandler = true; return; }
        guardas[i](req, res, function () { passo(i + 1); });
    };
    passo(0);
    return { autorizado: alcancouHandler, status: status };
}

test('supervisor da campanha alcança a rota de marcação', () => {
    const r = executarGuardas(middlewaresDaRota(ROTA, 'put'), {
        user: { name: 'admin', type: 'supervisor', campaign: { _id: 'camp-1' } }
    });
    assert.equal(r.autorizado, true, 'sessão de supervisor deveria passar; recebeu ' + r.status);
});

test('super-admin também alcança a rota de marcação', () => {
    const r = executarGuardas(middlewaresDaRota(ROTA, 'put'), {
        admin: { superAdmin: { username: 'admin' } }
    });
    assert.equal(r.autorizado, true);
});

test('inspetor não alcança a rota de marcação', () => {
    const r = executarGuardas(middlewaresDaRota(ROTA, 'put'), {
        user: { name: 'joao', type: 'inspector', campaign: { _id: 'camp-1' } }
    });
    assert.equal(r.autorizado, false);
    assert.equal(r.status, 401);
});

test('requisição sem sessão não alcança a rota de marcação', () => {
    const r = executarGuardas(middlewaresDaRota(ROTA, 'put'), {});
    assert.equal(r.autorizado, false);
    assert.equal(r.status, 401);
});
