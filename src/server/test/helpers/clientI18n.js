/**
 * Executa o `i18nService` real (client/others/i18n.js) fora do Angular, com
 * $http/$q síncronos que leem os dicionários do disco. Serve aos testes que
 * precisam de traduções verdadeiras sem subir o navegador.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const CLIENT_DIR = path.join(__dirname, '..', '..', '..', 'client');
const I18N_SOURCE = path.join(CLIENT_DIR, 'others', 'i18n.js');

function resolvido(valor) {
    return {
        then: function (fn) { return resolvido(fn ? fn(valor) : valor); },
        catch: function () { return this; }
    };
}

function carregarModulo() {
    const registro = { factory: {}, filter: {}, directive: {} };
    const Application = {
        factory: function (nome, fn) { registro.factory[nome] = fn; },
        filter: function (nome, fn) { registro.filter[nome] = fn; },
        directive: function (nome, fn) { registro.directive[nome] = fn; }
    };
    return { registro: registro, Application: Application };
}

function criarI18nService(idioma) {
    const modulo = carregarModulo();
    const contexto = vm.createContext({
        Application: modulo.Application,
        console: console,
        navigator: { language: idioma },
        localStorage: {
            getItem: function () { return idioma; },
            setItem: function () {}
        }
    });
    vm.runInContext(fs.readFileSync(I18N_SOURCE, 'utf8'), contexto, { filename: I18N_SOURCE });

    const $http = {
        get: function (url) {
            const arquivo = path.join(CLIENT_DIR, url);
            return resolvido({ data: JSON.parse(fs.readFileSync(arquivo, 'utf8')) });
        }
    };
    const $q = {
        resolve: resolvido,
        all: function (lista) { return resolvido(lista); }
    };
    const $rootScope = { $broadcast: function () {} };

    const service = modulo.registro.factory.i18nService($http, $rootScope, $q);
    service.filtroI18n = modulo.registro.filter.i18n(service, $rootScope);
    return service;
}

module.exports = { criarI18nService: criarI18nService };
