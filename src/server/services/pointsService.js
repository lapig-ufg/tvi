/**
 * pointsService — wrapper único para mutações destrutivas sobre `points`.
 *
 * Introduzido no Tier 1 (2026-05-09) do plano de defesa contra perda de
 * inspeções (clever-dreaming-pudding.md §1.2). Centraliza TODA escrita em
 * `points.userName`, `points.inspection`, `points.classConsolidated` e os
 * campos de soft-delete (`archivedAt`, `archivedReason`).
 *
 * Para cada mutação, registra um documento append-only em `points_audit`
 * contendo snapshots `before` e `after`. Falha em registrar audit → falha
 * a operação inteira. Não há caminho de mutação destrutiva que não passe
 * por aqui (a partir do Tier 1.6 de migração dos handlers).
 *
 * Convenção de `ctx` (contexto da requisição):
 *   {
 *     actor: { username, role?, sessionId?, ip? },     // obrigatório
 *     reason: 'string ≥ 10 chars',                     // obrigatório em destrutivos
 *     blockId: ObjectId | null,                        // se a operação vem de um bloco
 *     confirmationToken: 'uuid' | null                 // se foi via fluxo de token
 *   }
 *
 * Métodos:
 *   appendInspection(pointId, inspectorName, inspection, ctx)
 *   softWipePoint(pointId, ctx)
 *   removeInspectorByIndex(pointId, inspectorName, ctx)
 *   setClassConsolidated(pointId, value, ctx)
 *   restore(pointId, ctx)
 */

module.exports = function (app) {

    const REQUIRED_AUDIT_FIELDS = ['userName', 'inspection', 'classConsolidated', 'archivedAt', 'archivedReason'];

    function getPointsCollection() {
        if (!app.repository || !app.repository.collections || !app.repository.collections.points) {
            throw new Error('pointsService: collection points indisponível (repository não inicializado)');
        }
        return app.repository.collections.points;
    }

    function getAuditCollection() {
        if (!app.repository || !app.repository.collections || !app.repository.collections.points_audit) {
            throw new Error('pointsService: collection points_audit indisponível (repository não inicializado)');
        }
        return app.repository.collections.points_audit;
    }

    function getLogger() {
        return app.services && app.services.logger;
    }

    function snapshot(pointDb) {
        if (!pointDb) return null;
        const out = {};
        REQUIRED_AUDIT_FIELDS.forEach(function (k) {
            // Cópia rasa intencional — arrays/valores primitivos. Suficiente
            // porque o documento é descartado depois.
            out[k] = pointDb[k] === undefined ? null : pointDb[k];
        });
        return out;
    }

    function validateCtx(ctx, options) {
        options = options || {};
        if (!ctx || !ctx.actor || !ctx.actor.username) {
            throw new Error('pointsService: ctx.actor.username é obrigatório');
        }
        if (options.requireReason) {
            if (!ctx.reason || typeof ctx.reason !== 'string' || ctx.reason.trim().length < 10) {
                throw new Error('pointsService: ctx.reason (≥10 chars) é obrigatório em mutações destrutivas');
            }
        }
    }

    async function writeAudit(entry) {
        const auditCol = getAuditCollection();
        // Mongo driver native — usa Promise quando callback omitido.
        // insertOne é atômico por documento e não tolera retry silencioso —
        // se falhar, propagamos o erro para abortar a operação chamadora.
        return auditCol.insertOne(entry);
    }

    async function loadPoint(pointId) {
        const points = getPointsCollection();
        return points.findOne({ _id: pointId });
    }

    /**
     * Anexa uma inspeção ao ponto. Único caminho permitido para crescer
     * userName/inspection. Equivalente ao $push usado em updatePoint, mas
     * com (1) verificação de duplicidade do inspetor, (2) audit log antes
     * e depois.
     *
     * `options.pointDbBefore` permite ao caller passar o documento já
     * carregado (otimização para hot path como updatePoint que precisa do
     * pointDb antes para decidir consolidação). Quando passado, evita uma
     * leitura redundante.
     */
    async function appendInspection(pointId, inspectorName, inspection, ctx, options) {
        validateCtx(ctx);
        if (!pointId) throw new Error('pointsService.appendInspection: pointId obrigatório');
        if (!inspectorName) throw new Error('pointsService.appendInspection: inspectorName obrigatório');
        if (!inspection) throw new Error('pointsService.appendInspection: inspection obrigatório');

        const points = getPointsCollection();
        const before = (options && options.pointDbBefore) || await loadPoint(pointId);
        if (!before) {
            throw new Error('pointsService.appendInspection: ponto não encontrado: ' + pointId);
        }

        // Idempotência: se o inspetor já está em userName, rejeita (Tier 2 reforça
        // isso na camada do controller). Aqui é defesa em profundidade.
        const existing = Array.isArray(before.userName) ? before.userName : [];
        if (existing.indexOf(inspectorName) !== -1) {
            const err = new Error('Inspetor ' + inspectorName + ' já consta em userName do ponto ' + pointId);
            err.code = 'DUPLICATE_INSPECTOR';
            throw err;
        }

        // Tier 2.5 (2026-05-10) — hard-limit de userName.length.
        // Bloqueia anexação quando o ponto já atingiu o limite (numInspec humanos
        // + 1 entrada de classificação automática). Descoberto via simulação real
        // em mapbiomas_pastagem_col11: blocos round=2 reentregavam pontos que já
        // tinham 2 humanos quando outros pontos do bloco ainda eram pendentes,
        // causando 3 humanos no userName e violando numInspec.
        // O caller passa ctx.maxUserNameLength = numInspec + 1.
        if (typeof ctx.maxUserNameLength === 'number' && existing.length >= ctx.maxUserNameLength) {
            const err = new Error('Ponto ' + pointId + ' já atingiu o limite de inspeções (' + existing.length + '/' + ctx.maxUserNameLength + ')');
            err.code = 'POINT_ALREADY_FULL';
            throw err;
        }

        const updateStruct = {
            $push: {
                inspection: inspection,
                userName: inspectorName
            },
            $inc: {
                userNameCount: 1
            }
        };

        // Mantém compatibilidade com fluxo legado: handler ainda decide se
        // chama setClassConsolidated separadamente (não fundimos aqui).
        const result = await points.updateOne({ _id: pointId }, updateStruct);
        const after = await loadPoint(pointId);

        await writeAudit({
            ts: new Date(),
            pointId: pointId,
            campaignId: before.campaign,
            operation: 'append_inspection',
            actor: ctx.actor,
            reason: ctx.reason || null,
            blockId: ctx.blockId || null,
            confirmationToken: ctx.confirmationToken || null,
            before: snapshot(before),
            after: snapshot(after),
            metadata: {
                inspector: inspectorName,
                resultModified: result && (result.modifiedCount || result.nModified) || 0
            }
        });

        return after;
    }

    /**
     * Soft-wipe: marca o ponto como arquivado e zera arrays. Substitui o
     * hard-wipe que existia em Points.removeInspections / removeInspectionAdmin.
     * O snapshot completo de userName/inspection/classConsolidated fica em
     * points_audit; pode ser restaurado via restore().
     */
    async function softWipePoint(pointId, ctx) {
        validateCtx(ctx, { requireReason: true });
        if (!pointId) throw new Error('pointsService.softWipePoint: pointId obrigatório');

        const points = getPointsCollection();
        const before = await loadPoint(pointId);
        if (!before) {
            throw new Error('pointsService.softWipePoint: ponto não encontrado: ' + pointId);
        }

        const now = new Date();
        const updateStruct = {
            $set: {
                inspection: [],
                userName: [],
                classConsolidated: [],
                userNameCount: 0,
                underInspection: 0,
                archivedAt: now,
                archivedReason: ctx.reason,
                archivedBy: ctx.actor.username,
                updateAt: now
            }
        };

        const result = await points.updateOne({ _id: pointId }, updateStruct);
        const after = await loadPoint(pointId);

        await writeAudit({
            ts: now,
            pointId: pointId,
            campaignId: before.campaign,
            operation: 'soft_wipe',
            actor: ctx.actor,
            reason: ctx.reason,
            blockId: ctx.blockId || null,
            confirmationToken: ctx.confirmationToken || null,
            before: snapshot(before),
            after: snapshot(after),
            metadata: {
                resultModified: result && (result.modifiedCount || result.nModified) || 0
            }
        });

        const logger = getLogger();
        if (logger) {
            await logger.warn('softWipePoint executado', {
                module: 'pointsService',
                function: 'softWipePoint',
                metadata: { pointId: pointId, campaignId: before.campaign, actor: ctx.actor.username, reason: ctx.reason }
            });
        }

        return after;
    }

    /**
     * Remove um inspetor específico do ponto (operação usada por discardBlock).
     * Mantém os demais inspetores intactos. Ao contrário do hard-remove anterior,
     * grava snapshot em points_audit antes e depois.
     */
    async function removeInspectorByIndex(pointId, inspectorName, ctx) {
        validateCtx(ctx, { requireReason: true });
        if (!pointId) throw new Error('pointsService.removeInspectorByIndex: pointId obrigatório');
        if (!inspectorName) throw new Error('pointsService.removeInspectorByIndex: inspectorName obrigatório');

        const points = getPointsCollection();
        const before = await loadPoint(pointId);
        if (!before) {
            throw new Error('pointsService.removeInspectorByIndex: ponto não encontrado: ' + pointId);
        }

        const userNames = Array.isArray(before.userName) ? before.userName : [];
        const userIndex = userNames.indexOf(inspectorName);
        if (userIndex === -1) {
            // Idempotente: nada a remover.
            return before;
        }

        const newUserName = userNames.filter(function (_, idx) { return idx !== userIndex; });
        const inspections = Array.isArray(before.inspection) ? before.inspection : [];
        const newInspection = inspections.filter(function (_, idx) { return idx !== userIndex; });

        const updateSet = {
            userName: newUserName,
            inspection: newInspection,
            userNameCount: newUserName.length,
            updateAt: new Date()
        };
        // Sempre que removemos um inspetor, classConsolidated fica obsoleta.
        if (before.classConsolidated && before.classConsolidated.length > 0) {
            updateSet.classConsolidated = [];
        }

        const result = await points.updateOne({ _id: pointId }, { $set: updateSet });
        const after = await loadPoint(pointId);

        await writeAudit({
            ts: new Date(),
            pointId: pointId,
            campaignId: before.campaign,
            operation: 'remove_by_index',
            actor: ctx.actor,
            reason: ctx.reason,
            blockId: ctx.blockId || null,
            confirmationToken: ctx.confirmationToken || null,
            before: snapshot(before),
            after: snapshot(after),
            metadata: {
                inspector: inspectorName,
                removedIndex: userIndex,
                resultModified: result && (result.modifiedCount || result.nModified) || 0
            }
        });

        return after;
    }

    /**
     * Atualiza apenas classConsolidated. Único caminho para escrever esse campo
     * fora de appendInspection. Usado por updatePoint quando consolida e por
     * updateClassConsolidatedAdmin.
     */
    async function setClassConsolidated(pointId, value, ctx) {
        validateCtx(ctx);
        if (!pointId) throw new Error('pointsService.setClassConsolidated: pointId obrigatório');
        if (!Array.isArray(value)) {
            throw new Error('pointsService.setClassConsolidated: value deve ser array');
        }

        const points = getPointsCollection();
        const before = await loadPoint(pointId);
        if (!before) {
            throw new Error('pointsService.setClassConsolidated: ponto não encontrado: ' + pointId);
        }

        const result = await points.updateOne(
            { _id: pointId },
            { $set: { classConsolidated: value, updateAt: new Date() } }
        );
        const after = await loadPoint(pointId);

        await writeAudit({
            ts: new Date(),
            pointId: pointId,
            campaignId: before.campaign,
            operation: 'set_consolidated',
            actor: ctx.actor,
            reason: ctx.reason || null,
            blockId: ctx.blockId || null,
            confirmationToken: ctx.confirmationToken || null,
            before: snapshot(before),
            after: snapshot(after),
            metadata: {
                resultModified: result && (result.modifiedCount || result.nModified) || 0
            }
        });

        return after;
    }

    /**
     * Restaura o ponto a partir do último snapshot `before` registrado em
     * points_audit. Útil para reverter um softWipePoint ou um
     * removeInspectorByIndex executado por engano.
     *
     * Devolve `null` se não houver audit para o ponto.
     */
    async function restore(pointId, ctx) {
        validateCtx(ctx, { requireReason: true });
        if (!pointId) throw new Error('pointsService.restore: pointId obrigatório');

        const points = getPointsCollection();
        const auditCol = getAuditCollection();

        // Sort por ts E _id (descendente). _id é necessário porque várias
        // operações em um mesmo `updatePoint` podem gravar audits no mesmo
        // milissegundo (ts é um Date com precisão ms). ObjectId codifica um
        // contador interno e desempata na ordem real de inserção.
        const lastAudits = await auditCol
            .find({ pointId: pointId })
            .sort({ ts: -1, _id: -1 })
            .limit(1)
            .toArray();

        if (!lastAudits || lastAudits.length === 0) {
            return null;
        }
        const lastAudit = lastAudits[0];
        if (!lastAudit.before) {
            throw new Error('pointsService.restore: último audit do ponto ' + pointId + ' não tem snapshot before');
        }

        const before = await loadPoint(pointId);
        const beforeSnap = lastAudit.before;
        const updateSet = {
            userName: beforeSnap.userName || [],
            inspection: beforeSnap.inspection || [],
            classConsolidated: beforeSnap.classConsolidated || [],
            userNameCount: (beforeSnap.userName || []).length,
            archivedAt: beforeSnap.archivedAt || null,
            archivedReason: beforeSnap.archivedReason || null,
            updateAt: new Date()
        };
        const result = await points.updateOne({ _id: pointId }, { $set: updateSet });
        const after = await loadPoint(pointId);

        await writeAudit({
            ts: new Date(),
            pointId: pointId,
            campaignId: (before && before.campaign) || (after && after.campaign),
            operation: 'restore',
            actor: ctx.actor,
            reason: ctx.reason,
            blockId: ctx.blockId || null,
            confirmationToken: ctx.confirmationToken || null,
            before: snapshot(before),
            after: snapshot(after),
            metadata: {
                restoredFromAuditId: lastAudit._id,
                restoredFromOperation: lastAudit.operation,
                resultModified: result && (result.modifiedCount || result.nModified) || 0
            }
        });

        const logger = getLogger();
        if (logger) {
            await logger.info('Ponto restaurado a partir de points_audit', {
                module: 'pointsService',
                function: 'restore',
                metadata: { pointId: pointId, fromAuditId: String(lastAudit._id), actor: ctx.actor.username }
            });
        }

        return after;
    }

    return {
        appendInspection: appendInspection,
        softWipePoint: softWipePoint,
        removeInspectorByIndex: removeInspectorByIndex,
        setClassConsolidated: setClassConsolidated,
        restore: restore,
        // Exposto para testes
        _internal: {
            snapshot: snapshot,
            validateCtx: validateCtx
        }
    };
};
