/**
 * Executa o CampaignFormModalController (controllers/admin-modals.js) em vm,
 * com dublês de $http, NotificationDialog e $uibModalInstance e com os
 * núcleos reais do cliente, para testar o comportamento do cadastro sem
 * Angular.
 */

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const CLIENT_DIR = path.join(__dirname, '..', '..', '..', 'client');
const PointPropertyDisplayCore = require(path.join(CLIENT_DIR, 'services', 'point-property-display-core'));
const SampleMarkerCore = require(path.join(CLIENT_DIR, 'services', 'sample-marker-core'));

function fonteDoController() {
    const fonte = fs.readFileSync(path.join(CLIENT_DIR, 'controllers', 'admin-modals.js'), 'utf8');
    const inicio = fonte.indexOf("Application.controller('CampaignFormModalController'");
    assert.ok(inicio !== -1, 'CampaignFormModalController não encontrado');
    const fim = fonte.indexOf('Application.controller(', inicio + 1);
    return fonte.slice(inicio, fim === -1 ? undefined : fim);
}

// Promessa síncrona: resolve na hora, ou fica pendente quando `pendente`
// é verdadeiro e só resolve quando o teste chama `resolver`.
function promessa(resultado, falha, pendente) {
    const ouvintes = { ok: [], erro: [] };
    const objeto = {
        then: function (ok) {
            if (pendente) ouvintes.ok.push(ok);
            else if (!falha) ok(resultado);
            return {
                catch: function (erro) {
                    if (pendente) ouvintes.erro.push(erro);
                    else if (falha) erro(falha);
                }
            };
        },
        resolver: function (valor) { ouvintes.ok.forEach((ok) => ok(valor)); }
    };
    return objeto;
}

/**
 * respostas: mapa url -> resposta ({ data }), Error (falha) ou função
 * (url, config) -> promessa. confirmar: resposta do NotificationDialog.confirm.
 */
function abrirModal(campaign, isNew, respostas, confirmar) {
    const registro = {};
    const requisicoes = [];
    const confirmacoes = [];
    const contexto = vm.createContext({
        Application: { controller: function (nome, fn) { registro[nome] = fn; } },
        PointPropertyDisplayCore: PointPropertyDisplayCore,
        console: { error: function () {}, log: function () {}, warn: function () {} }
    });
    vm.runInContext(fonteDoController(), contexto);
    const $scope = {};
    const $http = {
        get: function (url, config) {
            requisicoes.push({ url: url, config: config });
            const resposta = (respostas || {})[url];
            if (typeof resposta === 'function') return resposta(url, config);
            if (resposta instanceof Error) return promessa(undefined, resposta);
            // Requisição sem resposta cadastrada (como /service/capabilities) fica pendente.
            if (resposta === undefined) return promessa(undefined, undefined, true);
            return promessa(resposta);
        }
    };
    const NotificationDialog = {
        error: function () {},
        confirm: function (mensagem, titulo) {
            confirmacoes.push({ mensagem: mensagem, titulo: titulo });
            return promessa(confirmar === undefined ? true : confirmar);
        }
    };
    registro.CampaignFormModalController($scope, { close: function () {}, dismiss: function () {} }, $http,
        campaign, isNew, NotificationDialog, { core: SampleMarkerCore });
    return { $scope: $scope, requisicoes: requisicoes, confirmacoes: confirmacoes };
}

module.exports = { abrirModal, promessa };
