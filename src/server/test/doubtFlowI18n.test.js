/**
 * Testes de tradução do fluxo de dúvidas do intérprete.
 *
 * Cobertura:
 *   - DoubtRegisterModalController (controllers/temporal.js): validações e
 *     falha de envio no idioma ativo; o texto do servidor, sempre em
 *     português, fica como detalhe secundário.
 *   - AdminDoubtResolveModalController (controllers/admin-modals.js): rótulos
 *     de status e de papel do autor, e fallback da marcação do supervisor.
 *   - Templates: botão "Tenho dúvida" como <button> (um <input> não tem
 *     conteúdo, então ícone e texto ficavam fora do botão), modal de
 *     registro e trechos do modal de dúvida vistos por intérprete e
 *     supervisor sem textos fixos em português.
 *
 * Roda como parte da suite normal: `cd src/server && npm test`.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { criarI18nService } = require('./helpers/clientI18n');

const CLIENT_DIR = path.join(__dirname, '..', '..', 'client');

function carregarControllers(arquivo) {
    const registro = {};
    const Application = new Proxy({}, {
        get: function (alvo, metodo) {
            return function (nome, fn) {
                if (metodo === 'controller') registro[nome] = fn;
                return Application;
            };
        }
    });
    const caminho = path.join(CLIENT_DIR, 'controllers', arquivo);
    vm.runInContext(fs.readFileSync(caminho, 'utf8'),
        vm.createContext({
            Application: Application,
            angular: { copy: function (v) { return JSON.parse(JSON.stringify(v)); } },
            window: {},
            console: console
        }),
        { filename: caminho });
    return registro;
}

function httpFalso(resposta) {
    const chamada = function () {
        return {
            then: function (sucesso, falha) {
                if (resposta.ok) sucesso({ data: resposta.data });
                else falha({ data: resposta.data });
            }
        };
    };
    return { post: chamada, put: chamada, get: chamada };
}

function instanciarRegistro(idioma, resposta) {
    const DoubtRegisterModalController = carregarControllers('temporal.js').DoubtRegisterModalController;
    const $scope = {};
    const fechamento = {};
    DoubtRegisterModalController(
        $scope,
        { close: function (v) { fechamento.valor = v; }, dismiss: function () {} },
        httpFalso(resposta || { ok: true, data: { doubt: { status: 'ABERTA' } } }),
        'IDN-0042',
        'indonesia_2026_batch01',
        [2020, 2021],
        criarI18nService(idioma)
    );
    return { $scope: $scope, fechamento: fechamento };
}

function instanciarResolucao(idioma, modo, resposta) {
    const AdminDoubtResolveModalController = carregarControllers('admin-modals.js').AdminDoubtResolveModalController;
    const $scope = {};
    AdminDoubtResolveModalController(
        $scope,
        { close: function () {}, dismiss: function () {} },
        httpFalso(resposta || { ok: true, data: {} }),
        { _id: 'IDN-0042', doubt: { status: 'ABERTA', comments: [] } },
        { _id: 'indonesia_2026_batch01' },
        modo,
        criarI18nService(idioma)
    );
    return $scope;
}

test('registro: validações de tamanho no idioma ativo', () => {
    const { $scope } = instanciarRegistro('id');

    $scope.form.text = 'abc';
    $scope.submit();
    assert.equal($scope.errorMessage, 'Jelaskan pertanyaan Anda dengan minimal 5 karakter.');

    $scope.form.text = 'x'.repeat(2001);
    $scope.submit();
    assert.equal($scope.errorMessage, 'Teks melebihi batas 2000 karakter.');
});

test('registro: falha do servidor exibe mensagem traduzida com o detalhe do servidor', () => {
    const { $scope } = instanciarRegistro('id', { ok: false, data: { error: 'Sessão de usuário inválida' } });

    $scope.form.text = 'Tidak bisa membedakan kelas';
    $scope.submit();
    assert.equal($scope.errorMessage, 'Tidak dapat mencatat pertanyaan.');
    assert.equal($scope.errorDetail, 'Sessão de usuário inválida');
    assert.equal($scope.submitting, false);
});

test('registro: sucesso fecha o modal sem mensagem de erro', () => {
    const { $scope, fechamento } = instanciarRegistro('id');

    $scope.form.text = 'Tidak bisa membedakan kelas';
    $scope.form.year = '2021';
    $scope.submit();
    assert.equal($scope.errorMessage, null);
    assert.equal($scope.errorDetail, null);
    assert.deepEqual(fechamento.valor, { doubt: { status: 'ABERTA' } });
});

test('dúvida: status e papéis traduzidos; valores desconhecidos passam intactos', () => {
    const $scope = instanciarResolucao('id', 'reader');

    assert.equal($scope.statusLabel('ABERTA'), 'TERBUKA');
    assert.equal($scope.statusLabel('RESOLVIDA'), 'SELESAI');
    assert.equal($scope.statusLabel('OUTRO'), 'OUTRO');
    assert.equal($scope.roleLabel('inspector'), 'pemeriksa');
    assert.equal($scope.roleLabel('supervisor'), 'supervisor');
    assert.equal($scope.roleLabel('super-admin'), 'administrator');
    assert.equal($scope.roleLabel('outro'), 'outro');
});

test('dúvida: em português os status mantêm o texto exibido antes', () => {
    const $scope = instanciarResolucao('pt-BR', 'reader');
    assert.equal($scope.statusLabel('ABERTA'), 'ABERTA');
    assert.equal($scope.statusLabel('RESOLVIDA'), 'RESOLVIDA');
});

test('dúvida: falha da marcação do supervisor sem detalhe usa a mensagem traduzida', () => {
    const $scope = instanciarResolucao('id', 'supervisor', { ok: false, data: null });
    $scope.setDoubtMark('RESOLVIDO');
    assert.equal($scope.errorMessage, 'Tidak dapat memperbarui penandaan keraguan.');
});

function semComentarios(html) {
    return html.replace(/<!--[\s\S]*?-->/g, '').replace(/<style>[\s\S]*?<\/style>/g, '');
}

test('template temporal: botão de dúvida é <button> com textos traduzidos', () => {
    const html = fs.readFileSync(path.join(CLIENT_DIR, 'views', 'temporal.tpl.html'), 'utf8');
    const bloco = html.slice(html.indexOf('ng-click="openDoubtModal()"') - 300, html.indexOf('ng-click="openDoubtModal()"') + 1200);

    assert.match(bloco, /<button type="button" class="btn btn-warning"[\s\S]*?ng-click="openDoubtModal\(\)"/);
    assert.ok(!/<input type="button" class="btn btn-warning"/.test(bloco), 'botão de dúvida ainda é <input>');
    ['Registrar dúvida sobre este ponto', 'Tenho dúvida', 'Você registrou uma dúvida', 'Dúvida registrada'].forEach(function (texto) {
        assert.ok(bloco.indexOf(texto) === -1, 'texto fixo "' + texto + '" no bloco de dúvida');
    });
    assert.ok(bloco.indexOf("'DOUBT.I_HAVE_A_QUESTION' | i18n") !== -1);
});

test('template do modal de registro sem textos fixos em português', () => {
    const html = semComentarios(fs.readFileSync(path.join(CLIENT_DIR, 'views', 'doubt-register-modal.tpl.html'), 'utf8'));
    ['Registrar dúvida', 'Fechar', 'Ponto:', 'Campanha:', 'Descreva', 'caracteres', 'Ex.:', 'Ano de referência', 'opcional', 'Nenhum', 'Cancelar', 'Enviar dúvida']
        .forEach(function (texto) {
            assert.ok(html.indexOf(texto) === -1, 'texto fixo "' + texto + '" no modal de registro');
        });
    assert.match(html, /ng-if="errorDetail"/);
});

test('template do modal de dúvida: trechos de intérprete e supervisor traduzidos', () => {
    const html = semComentarios(fs.readFileSync(path.join(CLIENT_DIR, 'views', 'doubt-resolve-modal.tpl.html'), 'utf8'))
        .replace(/<div class="form-group"[^>]*ng-if="isAdminMode">[\s\S]*?\n    <\/div>/g, '')
        .replace(/<button[^>]*ng-if="isAdminMode[\s\S]*?<\/button>/g, '');
    ['Dúvida do ponto', 'Fechar', 'Status:', 'Aberta por', 'Em:', 'Resolvida por', 'Comentários', 'Nenhum comentário', 'Ano:', 'Histórico de status', ' por ']
        .forEach(function (texto) {
            assert.ok(html.indexOf(texto) === -1, 'texto fixo "' + texto + '" fora dos blocos de super-admin');
        });
    assert.match(html, /statusLabel\(doubt\.status\)/);
    assert.match(html, /roleLabel\(c\.author\.role\)/);
});

test('temporal.js: aviso de dúvida registrada traduzido', () => {
    const fonte = fs.readFileSync(path.join(CLIENT_DIR, 'controllers', 'temporal.js'), 'utf8');
    assert.ok(fonte.indexOf("'Dúvida registrada com sucesso.'") === -1);
    assert.ok(fonte.indexOf("i18nService.translate('DOUBT.REGISTER_SUCCESS')") !== -1);
});
