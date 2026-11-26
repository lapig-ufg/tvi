'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function notifications() {
    let factory;
    const events = {};
    const q = { defer() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; } };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../client/services/admin-notifications.js'), 'utf8'), {
        Application: { factory(name, fn) { factory = fn; } }
    });
    const service = factory(q, { $on(name, fn) { events[name] = fn; } });
    return { service, events };
}

test('confirmação administrativa só aceita após ação afirmativa', async () => {
    const { service } = notifications();
    const handle = service.show('confirm', 'Excluir?', 'Confirmação');
    let result;
    handle.result.then(value => { result = value; });
    await Promise.resolve();
    assert.equal(result, undefined);
    service.answer(service.items[0], false);
    assert.equal(await handle.result, false);
    assert.equal(service.items.length, 0);
});

test('navegação cancela perguntas para não executar ação na página anterior', async () => {
    const { service, events } = notifications();
    const confirm = service.show('confirm', 'Excluir?', 'Confirmação');
    const prompt = service.show('prompt', 'Nome', 'Cadastro', { value: 'rascunho' });
    events.$routeChangeStart();
    assert.equal(await confirm.result, false);
    assert.equal(await prompt.result, null);
});

test('prompt preserva texto e progresso pode ser atualizado e fechado', async () => {
    const { service } = notifications();
    const prompt = service.show('prompt', 'Nome', 'Cadastro', { value: 'rascunho' });
    const item = service.items[0];
    item.value = 'Nome confirmado';
    service.answer(item, true);
    assert.equal(await prompt.result, 'Nome confirmado');
    const progress = service.show('progress', 'Iniciando', 'Importação');
    progress.update('30 pontos processados');
    assert.equal(service.items[0].message, '30 pontos processados');
    progress.close();
    assert.equal(service.items.length, 0);
});
