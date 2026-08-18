/**
 * Testes de paridade de injeção de dependências nos controllers AngularJS.
 *
 * Contexto (2026-08-18): as ações de remover/editar inspeções do gerenciador
 * de campanhas não faziam nada ao serem clicadas. A causa raiz era o
 * `AdminCampaignPointsModalController` (controllers/admin-modals.js) usar
 * `NotificationDialog` em dezesseis pontos sem declará-lo na lista de
 * parâmetros do controller. Em AngularJS isso não é erro de carga: o
 * identificador simplesmente não existe em tempo de execução e a expressão
 * `ng-click` lança `ReferenceError`, que o `$exceptionHandler` engole. O
 * usuário clica e nada acontece, sem qualquer mensagem.
 *
 * Este teste é estático (não executa Angular): lê os arquivos de controller,
 * separa o corpo de cada `Application.controller(...)` e exige que todo
 * serviço da lista `SERVICOS_INJETAVEIS` referenciado no corpo apareça também
 * na assinatura. É a rede de proteção contra a repetição desse defeito.
 *
 * Roda como parte da suite normal: `cd src/server && npm test`.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CONTROLLERS_DIR = path.join(__dirname, '..', '..', 'client', 'controllers');

// Serviços próprios da aplicação. Os serviços nativos do Angular ($http,
// $scope, ...) ficam de fora porque nunca são usados sem injeção explícita.
const SERVICOS_INJETAVEIS = [
    'NotificationDialog',
    'i18nService',
    'requester',
    'fakeRequester',
    'waybackGridService',
    'util'
];

const DECLARACAO_CONTROLLER = /Application\.controller\(\s*['"]([^'"]+)['"]\s*,\s*function\s*\(([^)]*)\)/g;

function extrairControllers(fonte) {
    const ocorrencias = Array.from(fonte.matchAll(DECLARACAO_CONTROLLER));
    return ocorrencias.map(function (m, i) {
        const inicioCorpo = m.index + m[0].length;
        const fimCorpo = (i + 1 < ocorrencias.length) ? ocorrencias[i + 1].index : fonte.length;
        return {
            nome: m[1],
            parametros: m[2].split(',').map(function (s) { return s.trim(); }).filter(Boolean),
            corpo: fonte.slice(inicioCorpo, fimCorpo)
        };
    });
}

function arquivosDeController() {
    return fs.readdirSync(CONTROLLERS_DIR)
        .filter(function (f) { return f.endsWith('.js'); })
        .sort();
}

test('todo serviço usado por um controller está declarado na sua assinatura', () => {
    const pendencias = [];

    arquivosDeController().forEach(function (arquivo) {
        const fonte = fs.readFileSync(path.join(CONTROLLERS_DIR, arquivo), 'utf8');
        extrairControllers(fonte).forEach(function (ctrl) {
            SERVICOS_INJETAVEIS.forEach(function (servico) {
                const usa = new RegExp('\\b' + servico + '\\b').test(ctrl.corpo);
                if (usa && ctrl.parametros.indexOf(servico) === -1) {
                    pendencias.push(arquivo + ' :: ' + ctrl.nome + ' usa ' + servico + ' sem injetá-lo');
                }
            });
        });
    });

    assert.deepEqual(pendencias, [], 'Controllers com dependência não injetada:\n  ' + pendencias.join('\n  '));
});

test('o parser encontra os controllers de admin-modals.js', () => {
    // Sentinela: se a regex parar de casar (mudança de estilo do arquivo), o
    // teste acima passaria vazio e deixaria de proteger qualquer coisa.
    const fonte = fs.readFileSync(path.join(CONTROLLERS_DIR, 'admin-modals.js'), 'utf8');
    const nomes = extrairControllers(fonte).map(function (c) { return c.nome; });
    assert.ok(nomes.indexOf('AdminCampaignPointsModalController') !== -1);
    assert.ok(nomes.length >= 7, 'esperado ao menos 7 controllers em admin-modals.js, encontrados ' + nomes.length);
});
