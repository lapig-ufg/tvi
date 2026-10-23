/**
 * Testes de tradução do NotificationDialog (client/services/notification-dialog.js).
 *
 * O serviço é global: os títulos padrão e os botões dos diálogos aparecem em
 * todas as telas (supervisor, inspetor, tickets). O serviço é executado fora do
 * Angular com o i18nService real, e os templates entregues ao $uibModal são
 * inspecionados.
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

const SERVICE_PATH = path.join(__dirname, '..', '..', 'client', 'services', 'notification-dialog.js');

function instanciar(idioma) {
    const registro = {};
    const contexto = vm.createContext({
        Application: {
            factory: function (nome, fn) { registro[nome] = fn; }
        }
    });
    vm.runInContext(fs.readFileSync(SERVICE_PATH, 'utf8'), contexto, { filename: SERVICE_PATH });

    const templates = [];
    const $uibModal = {
        open: function (opcoes) {
            templates.push(opcoes.template);
            return { result: { then: function () {} }, close: function () {} };
        }
    };
    const $q = {
        defer: function () { return { promise: {}, resolve: function () {} }; }
    };
    const service = registro.NotificationDialog($uibModal, function () {}, $q, criarI18nService(idioma));
    return { service: service, ultimoTemplate: function () { return templates[templates.length - 1]; } };
}

function semEspacos(html) {
    return html.replace(/\s+/g, ' ');
}

test('títulos padrão e botão Fechar seguem o idioma ativo', () => {
    const { service, ultimoTemplate } = instanciar('id');
    const esperados = { success: 'Berhasil', error: 'Galat', warning: 'Perhatian', info: 'Informasi' };

    Object.keys(esperados).forEach(function (tipo) {
        service[tipo]('mensagem');
        const html = semEspacos(ultimoTemplate());
        assert.ok(html.indexOf(esperados[tipo]) !== -1, tipo + ': título "' + esperados[tipo] + '" ausente');
        assert.ok(html.indexOf('>Tutup<') !== -1, tipo + ': botão Tutup ausente');
    });
});

test('título informado pelo chamador prevalece sobre o padrão', () => {
    const { service, ultimoTemplate } = instanciar('id');
    service.warning('mensagem', 'Judul khusus');
    assert.ok(ultimoTemplate().indexOf('Judul khusus') !== -1);
    assert.ok(ultimoTemplate().indexOf('Perhatian') === -1);
});

test('confirmação traduz título e botões Sim/Não', () => {
    const { service, ultimoTemplate } = instanciar('id');
    service.confirm('mensagem');
    const html = semEspacos(ultimoTemplate());
    assert.ok(html.indexOf('Konfirmasi') !== -1);
    assert.ok(/<\/i> Ya </.test(html), 'botão Ya ausente');
    assert.ok(/<\/i> Tidak </.test(html), 'botão Tidak ausente');
});

test('código de erro, prompt e progresso traduzidos', () => {
    const { service, ultimoTemplate } = instanciar('id');

    service.error('mensagem', null, 'ERR-1');
    assert.ok(ultimoTemplate().indexOf('Kode Galat:') !== -1);
    assert.ok(ultimoTemplate().indexOf('Salin') !== -1);

    service.prompt('mensagem');
    assert.ok(ultimoTemplate().indexOf('Masukkan nilai') !== -1);
    assert.ok(ultimoTemplate().indexOf('Batal') !== -1);

    service.progress();
    assert.ok(ultimoTemplate().indexOf('Memproses...') !== -1);
    assert.ok(ultimoTemplate().indexOf('Mohon tunggu...') !== -1);
});

test('handleServerError usa mensagem e título traduzidos', () => {
    const { service, ultimoTemplate } = instanciar('id');
    service.handleServerError(null);
    const html = ultimoTemplate();
    assert.ok(html.indexOf('Galat internal server') !== -1);
});

test('em português os textos permanecem os mesmos', () => {
    const { service, ultimoTemplate } = instanciar('pt-BR');
    service.confirm('mensagem');
    const html = semEspacos(ultimoTemplate());
    assert.ok(html.indexOf('Confirmação') !== -1);
    assert.ok(/<\/i> Sim </.test(html));
    assert.ok(/<\/i> Não </.test(html));

    service.error('mensagem', null, 'ERR-1');
    assert.ok(ultimoTemplate().indexOf('Código de Erro:') !== -1);
    assert.ok(ultimoTemplate().indexOf('>Fechar<') !== -1);
});

test('fonte do serviço sem textos de interface fixos em português', () => {
    const fonte = fs.readFileSync(SERVICE_PATH, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
    ['Sucesso', 'Atenção', 'Informação', 'Confirmação', 'Notificação', 'Fechar', 'Cancelar',
        'Copiar', 'Copiado', 'Digite um valor', 'Processando', 'aguarde', 'Erro interno', 'Código de Erro', '> Sim', '> Não']
        .forEach(function (texto) {
            assert.ok(fonte.indexOf(texto) === -1, 'texto fixo "' + texto + '" em notification-dialog.js');
        });
});
