/**
 * Planejamento de remoção de inspeções do gerenciador de campanhas.
 *
 * Introduzido em 2026-08-18. A aba "Remover Inspeções"
 * (views/campaign-points-modal.tpl.html) calculava a pré-visualização no
 * cliente, sobre a página de pontos carregada naquele momento, enquanto o
 * servidor — que sequer tinha os endpoints implementados — deveria aplicar o
 * critério sobre a campanha inteira. Qualquer divergência entre as duas
 * lógicas produziria remoção diferente da prevista.
 *
 * A solução é ter uma única implementação, aqui, no servidor: a
 * pré-visualização e a execução chamam o mesmo endpoint, mudando apenas o
 * parâmetro `dryRun`. Este módulo é puro (não toca em Mongo nem em Express)
 * para ser testável isoladamente — ver test/inspectionRemovalPlan.test.js.
 *
 * Critérios suportados:
 *   by_user         — remove a inspeção de um inspetor específico, preservando
 *                     as demais inspeções do ponto.
 *   by_point        — remove todas as inspeções de um ponto.
 *   incomplete_only — remove todas as inspeções dos pontos que têm ao menos
 *                     uma inspeção mas ainda não atingiram `numInspec`.
 */

'use strict';

const TIPOS_SUPORTADOS = ['by_user', 'by_point', 'incomplete_only'];

// Teto de segurança para uma única execução. Não é um recorte silencioso: ao
// ser ultrapassado, a operação é recusada com mensagem explícita, em vez de
// remover parte do conjunto e dar a impressão de ter removido tudo.
const LIMITE_PONTOS_POR_EXECUCAO = 5000;

/**
 * Valida e normaliza o critério vindo do cliente.
 * Lança Error com `.status = 400` quando inválido.
 */
function normalizeCriteria(criteria) {
    const erro = function (mensagem) {
        const e = new Error(mensagem);
        e.status = 400;
        return e;
    };

    if (!criteria || typeof criteria !== 'object') {
        throw erro('Critério de remoção não informado.');
    }
    const tipo = criteria.type;
    if (TIPOS_SUPORTADOS.indexOf(tipo) === -1) {
        throw erro('Tipo de remoção inválido: ' + String(tipo) + '. Suportados: ' + TIPOS_SUPORTADOS.join(', ') + '.');
    }
    if (tipo === 'by_user') {
        if (!criteria.user || typeof criteria.user !== 'string' || !criteria.user.trim()) {
            throw erro('O critério "by_user" exige o nome do inspetor.');
        }
        return { type: tipo, user: criteria.user.trim() };
    }
    if (tipo === 'by_point') {
        if (!criteria.pointId || typeof criteria.pointId !== 'string' || !criteria.pointId.trim()) {
            throw erro('O critério "by_point" exige o identificador do ponto.');
        }
        return { type: tipo, pointId: criteria.pointId.trim() };
    }
    return { type: tipo };
}

/**
 * Monta o filtro Mongo que seleciona os pontos candidatos ao critério.
 *
 * `incomplete_only` usa `$expr` para comparar a quantidade de inspeções com
 * `numInspec` dentro do banco, evitando trazer a campanha inteira para a
 * memória. `$ifNull` sobre `userNameCount` cobre documentos legados anteriores
 * ao campo denormalizado (mesma estratégia de controllers/points.js).
 * Requer MongoDB >= 3.6; produção roda 4.4.
 */
function buildCandidateFilter(campaignId, criteria, numInspec) {
    const base = { campaign: campaignId };

    if (criteria.type === 'by_point') {
        base._id = criteria.pointId;
        return base;
    }

    if (criteria.type === 'by_user') {
        base.userName = criteria.user;
        return base;
    }

    // incomplete_only
    base['userName.0'] = { $exists: true };
    base.$expr = {
        $lt: [
            { $ifNull: ['$userNameCount', { $size: { $ifNull: ['$userName', []] } }] },
            numInspec
        ]
    };
    return base;
}

/**
 * Converte os pontos candidatos em ações concretas.
 *
 * Devolve `{ actions, pointsAffected, inspectionsAffected }`, em que cada ação
 * é `{ pointId, operation, inspector? , inspectors }`:
 *   - operation 'remove_inspector' → pointsService.removeInspectorByIndex
 *   - operation 'clear_inspections' → pointsService.clearInspections
 *
 * Pontos sem nenhuma inspeção são ignorados: não há o que remover e incluí-los
 * inflaria a contagem exibida ao usuário antes da confirmação.
 */
function buildRemovalPlan(points, criteria, numInspec) {
    const actions = [];
    let inspectionsAffected = 0;

    (points || []).forEach(function (point) {
        const inspetores = Array.isArray(point.userName) ? point.userName : [];
        if (inspetores.length === 0) {
            return;
        }

        if (criteria.type === 'by_user') {
            if (inspetores.indexOf(criteria.user) === -1) {
                return;
            }
            actions.push({
                pointId: point._id,
                operation: 'remove_inspector',
                inspector: criteria.user,
                inspectors: [criteria.user]
            });
            inspectionsAffected += 1;
            return;
        }

        if (criteria.type === 'incomplete_only' && inspetores.length >= numInspec) {
            // Defesa em profundidade: o filtro Mongo já exclui os completos.
            return;
        }

        actions.push({
            pointId: point._id,
            operation: 'clear_inspections',
            inspectors: inspetores.slice()
        });
        inspectionsAffected += inspetores.length;
    });

    return {
        actions: actions,
        pointsAffected: actions.length,
        inspectionsAffected: inspectionsAffected
    };
}

/**
 * Achata o plano no formato consumido pela tabela de pré-visualização do
 * cliente: uma linha por inspeção que será removida.
 */
function buildPreviewRows(plan) {
    const rows = [];
    plan.actions.forEach(function (action) {
        action.inspectors.forEach(function (inspetor) {
            rows.push({
                pointId: action.pointId,
                user: inspetor,
                operation: action.operation
            });
        });
    });
    return rows;
}

module.exports = {
    TIPOS_SUPORTADOS: TIPOS_SUPORTADOS,
    LIMITE_PONTOS_POR_EXECUCAO: LIMITE_PONTOS_POR_EXECUCAO,
    normalizeCriteria: normalizeCriteria,
    buildCandidateFilter: buildCandidateFilter,
    buildRemovalPlan: buildRemovalPlan,
    buildPreviewRows: buildPreviewRows
};
