/**
 * Testes do i18nService (client/others/i18n.js) executado fora do Angular.
 *
 * Cobertura:
 *   - Interpolação de parâmetros `{{nome}}`: o NotificationDialog compila a
 *     mensagem como template Angular, então um marcador não substituído vira
 *     texto vazio na tela (ex.: "remover as inspeções do ponto ?").
 *   - Sem parâmetros, os marcadores permanecem intactos, porque tickets.js e
 *     admin-tickets.js fazem a substituição manualmente com `.replace`.
 *   - O filtro `i18n` repassa os parâmetros ao serviço.
 *
 * Roda como parte da suite normal: `cd src/server && npm test`.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { criarI18nService } = require('./helpers/clientI18n');

test('translate substitui os parâmetros informados', () => {
    const i18n = criarI18nService('pt-BR');
    assert.equal(
        i18n.translate('ALERTS.INSPECTIONS_REMOVED', { pointId: 'p-42' }),
        'As inspeções do ponto p-42 foram removidas com sucesso.'
    );
    assert.equal(i18n.translate('ALERTS.POINTS_CORRECTED', { count: 0 }), 'Pontos corrigidos: 0');
});

test('translate sem parâmetros preserva os marcadores', () => {
    const i18n = criarI18nService('pt-BR');
    assert.equal(i18n.translate('ALERTS.POINTS_CORRECTED'), 'Pontos corrigidos: {{count}}');
});

test('translate mantém marcadores sem valor correspondente', () => {
    const i18n = criarI18nService('id');
    assert.equal(
        i18n.translate('ALERTS.CAMPAIGN_DELETE_CONFIRM', { outro: 'x' }),
        'Apakah Anda yakin ingin menghapus kampanye "{{campaignId}}"?'
    );
});

test('translate devolve a chave quando ela não existe', () => {
    const i18n = criarI18nService('id');
    assert.equal(i18n.translate('NAO.EXISTE', { a: 1 }), 'NAO.EXISTE');
});

test('filtro i18n repassa os parâmetros', () => {
    const i18n = criarI18nService('id');
    assert.equal(
        i18n.filtroI18n('ALERTS.INSPECTIONS_REMOVED', { pointId: 'p-7' }),
        i18n.translate('ALERTS.INSPECTIONS_REMOVED', { pointId: 'p-7' })
    );
    assert.ok(i18n.filtroI18n('ALERTS.INSPECTIONS_REMOVED', { pointId: 'p-7' }).indexOf('p-7') !== -1);
});
