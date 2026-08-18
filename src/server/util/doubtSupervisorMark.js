/**
 * Marcação de dúvida pelo supervisor (2026-08-18).
 *
 * A tela do supervisor passa a exibir três rótulos para a dúvida de um ponto:
 *
 *   não visto  → a dúvida está aberta e ainda não recebeu tratamento
 *   resolvido  → a dúvida foi encerrada (ciclo que já existia: ABERTA/RESOLVIDA)
 *   exemplo    → o caso foi considerado didático; é apenas um rótulo, sem
 *                efeito sobre o ciclo da dúvida
 *
 * Decisão de modelagem: o rótulo é DERIVADO, não armazenado em duplicidade.
 * Só `doubt.example` é campo novo; "não visto" e "resolvido" continuam sendo
 * leitura de `doubt.status`. Guardar um segundo campo de status abriria espaço
 * para divergência — por exemplo, um super-admin resolvendo a dúvida pelo
 * painel administrativo sem que a marcação do supervisor acompanhasse.
 *
 * Este módulo é puro: recebe a subestrutura `doubt` e devolve a mutação a
 * aplicar. Quem fala com o Mongo é controllers/doubts.js.
 * Testes em test/doubtSupervisorMark.test.js.
 */

'use strict';

const NAO_VISTO = 'NAO_VISTO';
const RESOLVIDO = 'RESOLVIDO';
const EXEMPLO = 'EXEMPLO';

const VALID_MARKS = [NAO_VISTO, RESOLVIDO, EXEMPLO];

/**
 * Deriva o rótulo exibido a partir do estado atual da dúvida.
 *
 * A ordem importa: `example` prevalece sobre o status porque é a marcação
 * mais recente e explícita do supervisor. Marcar como resolvido limpa o
 * exemplo (ver buildMarkUpdate), de modo que os dois nunca coexistem em
 * consequência de uma ação do supervisor.
 */
function deriveMark(doubt) {
    if (!doubt) {
        return null;
    }
    if (doubt.example === true) {
        return EXEMPLO;
    }
    if (doubt.status === 'RESOLVIDA') {
        return RESOLVIDO;
    }
    return NAO_VISTO;
}

/**
 * Monta a mutação correspondente à marcação pedida.
 *
 * Devolve:
 *   { noop: true }                          — a dúvida já está nesse rótulo
 *   { setFields, historyEntry, resolved }   — mutação a aplicar
 *
 * `resolved` indica se esta transição encerrou a dúvida, informação usada pelo
 * controller para disparar a notificação no Telegram (o mesmo evento emitido
 * quando um super-admin resolve pelo painel administrativo).
 *
 * Lança Error com `.status = 400` para marcação inválida.
 */
function buildMarkUpdate(doubt, mark, authorName, now) {
    if (VALID_MARKS.indexOf(mark) === -1) {
        const e = new Error('Marcação inválida. Valores aceitos: ' + VALID_MARKS.join(', ') + '.');
        e.status = 400;
        throw e;
    }
    if (!doubt) {
        const e = new Error('Dúvida não encontrada');
        e.status = 404;
        throw e;
    }

    const atual = deriveMark(doubt);
    if (atual === mark) {
        return { noop: true };
    }

    const statusAtual = doubt.status || 'ABERTA';
    const setFields = {};
    let statusAlvo = statusAtual;

    if (mark === EXEMPLO) {
        // Rótulo puro: não encerra a dúvida nem altera contadores. Um ponto
        // marcado como exemplo com a dúvida aberta continua pendente.
        setFields['doubt.example'] = true;
        setFields['doubt.exampleBy'] = authorName;
        setFields['doubt.exampleAt'] = now;
    } else {
        // "não visto" e "resolvido" operam o ciclo da dúvida e, por serem
        // rótulos exclusivos, retiram a marca de exemplo.
        statusAlvo = (mark === RESOLVIDO) ? 'RESOLVIDA' : 'ABERTA';
        setFields['doubt.example'] = false;
        setFields['doubt.exampleBy'] = null;
        setFields['doubt.exampleAt'] = null;
        setFields['doubt.status'] = statusAlvo;
        if (statusAlvo === 'RESOLVIDA') {
            setFields['doubt.resolvedBy'] = authorName;
            setFields['doubt.resolvedAt'] = now;
        } else {
            setFields['doubt.resolvedBy'] = null;
            setFields['doubt.resolvedAt'] = null;
        }
    }

    return {
        noop: false,
        setFields: setFields,
        // Toda marcação entra em statusHistory, inclusive a de exemplo, que não
        // muda o status: é o que permite reconstruir quem marcou o quê e quando.
        historyEntry: {
            from: statusAtual,
            to: statusAlvo,
            mark: mark,
            changedBy: authorName,
            reason: 'Marcado como "' + mark + '" pelo supervisor',
            changedAt: now
        },
        resolved: statusAlvo === 'RESOLVIDA' && statusAtual !== 'RESOLVIDA'
    };
}

module.exports = {
    NAO_VISTO: NAO_VISTO,
    RESOLVIDO: RESOLVIDO,
    EXEMPLO: EXEMPLO,
    VALID_MARKS: VALID_MARKS,
    deriveMark: deriveMark,
    buildMarkUpdate: buildMarkUpdate
};
