/**
 * Tradução das telas de tickets do lado do usuário (formulário, lista,
 * detalhe e modal de troca de status): nenhum rótulo ou mensagem em
 * português no código dos controllers, toda chave citada existe nos três
 * idiomas e o formulário remonta as opções quando o idioma muda.
 *
 * Execução:
 *   cd src/server && npm test
 *   ou
 *   node --test src/server/test/ticketsI18n.test.js
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CLIENT_DIR = path.join(__dirname, '..', '..', 'client');
const IDIOMAS = ['pt-BR', 'en', 'id'];
const TEMPLATES = ['ticket-form.tpl.html', 'ticket-detail.tpl.html', 'tickets-list.tpl.html', 'ticket-status-modal.tpl.html'];
const CODIGOS = {
    TYPES: ['RECLAMACAO', 'SUGESTAO', 'DUVIDA', 'ELOGIO'],
    CATEGORIES: ['INTERFACE', 'DESEMPENHO', 'FUNCIONALIDADE', 'DADOS', 'OUTRO'],
    SEVERITIES: ['BAIXA', 'MEDIA', 'ALTA', 'CRITICA'],
    STATUSES: ['ABERTO', 'EM_ANALISE', 'EM_DESENVOLVIMENTO', 'RESOLVIDO', 'FECHADO']
};

function read(relative) {
    return fs.readFileSync(path.join(CLIENT_DIR, relative), 'utf8');
}

function traducoes(idioma) {
    return JSON.parse(read(`i18n/${idioma}.json`));
}

function resolver(json, chave) {
    return chave.split('.').reduce((atual, parte) => (atual && typeof atual === 'object' ? atual[parte] : undefined), json);
}

function corpoDoController(fonte, nome) {
    const inicio = fonte.indexOf(`Application.controller('${nome}'`);
    assert.ok(inicio !== -1, `${nome} não encontrado`);
    const proximo = fonte.indexOf('Application.controller(', inicio + 1);
    return fonte.slice(inicio, proximo === -1 ? undefined : proximo);
}

function codigoDosTickets() {
    return [
        read('controllers/tickets.js'),
        corpoDoController(read('controllers/admin-tickets.js'), 'TicketStatusModalController')
    ];
}

test('tickets.js e o modal de status não têm rótulos nem mensagens em português no código', () => {
    const proibidos = [
        "'Reclamação'", "'Sugestão'", "'Desempenho'", "'Funcionalidade'", "'Baixa'", "'Média'", "'Crítica'",
        "'Em Análise'", "'Por favor, preencha", "'Severidade é obrigatória", "'Apenas imagens", "'O arquivo excede",
        "'Erro ao enviar arquivo", "'Não foi possível carregar a dúvida", "'Selecione o novo status", "'O motivo é obrigatório"
    ];
    codigoDosTickets().forEach((fonte, indice) => {
        const encontrados = proibidos.filter((literal) => fonte.indexOf(literal) !== -1);
        assert.deepEqual(encontrados, [], `${indice === 0 ? 'tickets.js' : 'TicketStatusModalController'}: ${encontrados}`);
    });
});

test('toda chave TICKETS.* e ADMIN_TICKETS.* citada nas telas e controllers de ticket existe nos três idiomas', () => {
    const fontes = codigoDosTickets().concat(TEMPLATES.map((arquivo) => read(`views/${arquivo}`)));
    const chaves = new Set();
    fontes.forEach((fonte) => {
        for (const m of fonte.matchAll(/'((?:ADMIN_)?TICKETS\.[A-Z_.]*[A-Z_])'/g)) chaves.add(m[1]);
    });
    assert.ok(chaves.size > 20, `poucas chaves encontradas: ${chaves.size}`);
    IDIOMAS.forEach((idioma) => {
        const json = traducoes(idioma);
        const ausentes = Array.from(chaves).filter((chave) => {
            const valor = resolver(json, chave);
            return typeof valor !== 'string' || valor.trim() === '';
        });
        assert.deepEqual(ausentes, [], `${idioma}: chaves ausentes`);
    });
});

test('cada código de tipo, categoria, severidade e status tem rótulo nos três idiomas', () => {
    IDIOMAS.forEach((idioma) => {
        const json = traducoes(idioma);
        Object.entries(CODIGOS).forEach(([grupo, codigos]) => {
            codigos.forEach((codigo) => {
                const valor = resolver(json, `ADMIN_TICKETS.${grupo}.${codigo}`);
                assert.equal(typeof valor, 'string', `${idioma}: ADMIN_TICKETS.${grupo}.${codigo}`);
            });
        });
    });
    assert.deepEqual(resolver(traducoes('en'), 'ADMIN_TICKETS.SEVERITIES'),
        { BAIXA: 'Low', MEDIA: 'Medium', ALTA: 'High', CRITICA: 'Critical' });
    assert.deepEqual(resolver(traducoes('id'), 'ADMIN_TICKETS.SEVERITIES'),
        { BAIXA: 'Rendah', MEDIA: 'Sedang', ALTA: 'Tinggi', CRITICA: 'Kritis' });
    assert.deepEqual(resolver(traducoes('pt-BR'), 'ADMIN_TICKETS.SEVERITIES'),
        { BAIXA: 'Baixa', MEDIA: 'Média', ALTA: 'Alta', CRITICA: 'Crítica' });
});

test('formulário de ticket remonta as opções na troca de idioma', () => {
    const corpo = corpoDoController(read('controllers/tickets.js'), 'TicketFormController');
    assert.match(corpo, /\$scope\.\$on\('languageChanged'/);
    assert.match(corpo, /'SEVERITIES'/, 'severidade fora das chaves ADMIN_TICKETS.SEVERITIES');
});

test('expressões dos templates de ticket não carregam texto literal visível', () => {
    // O guarda de textos fixos ignora {{ }}; aqui os literais entre aspas
    // dentro das expressões só podem ser chaves i18n, formatos de data ou
    // classes CSS.
    const permitido = /^((ADMIN_)?TICKETS\.|COMMON\.)|^[dMyHms:\/. ]+$|^(btn|fa|label)-[a-z-]+$/;
    TEMPLATES.forEach((arquivo) => {
        const literais = [];
        for (const expressao of read(`views/${arquivo}`).matchAll(/\{\{([\s\S]*?)\}\}/g)) {
            for (const m of expressao[1].matchAll(/'([^']*)'/g)) {
                if (/\p{L}{2,}/u.test(m[1]) && !permitido.test(m[1])) literais.push(m[1]);
            }
        }
        assert.deepEqual(literais, [], `${arquivo}: literais em expressões`);
    });
});

test('admin-tickets.js não afirma que as severidades não têm chaves i18n', () => {
    assert.equal(read('controllers/admin-tickets.js').indexOf('não têm chaves i18n próprias'), -1);
});

test('modal de status mostra o status atual traduzido', () => {
    const template = read('views/ticket-status-modal.tpl.html');
    assert.equal(template.indexOf('{{ticket.status}}'), -1, 'código cru do status');
    assert.match(template, /statusLabel\(ticket\.status\)/);
});
