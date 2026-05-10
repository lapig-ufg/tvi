# Incidente — Perda massiva de inspeções no TVI (maio/2026)

> **Data do incidente identificado:** 2026-05-09
> **Campanha mais afetada:** `mapbiomas_pastagem_col11`
> **Volume estimado:** ~7.026 inspeções da segunda rodada perdidas (≈ 99% das que deveriam existir após 1.419 blocos round-2 marcados como `completed`).
> **Status:** mitigado por código (Tier 0–2 do plano em `~/.claude/plans/clever-dreaming-pudding.md`); recuperação dos dados perdidos requer reinspecção coordenada com a equipe de inspetores.

## Resumo executivo

A campanha `mapbiomas_pastagem_col11`, configurada com `numInspec = 2`
(dois inspetores por ponto), apresentou ao longo de meses um padrão de
perda silenciosa do trabalho do segundo inspetor. Os blocos round-2
eram marcados como `completed` no `tvi_blocos`, mas o `userName[]` dos
pontos correspondentes ficava sem o nome do segundo inspetor. Os
inspetores começaram a notar o problema no início de maio quando
relataram, em áudios para a equipe, que estavam recebendo blocos como
"Disponíveis" no temporal mesmo já tendo inspeção parcial. Investigação
iniciada em 2026-05-09 identificou o vetor primário e três agravantes.

## Cronologia técnica

1. **Geração de blocos**: cada conjunto de 5 pontos vira 2 documentos
   em `tvi_blocos` (round 1 e round 2), referenciando os mesmos
   `pointIds`. A "consolidação" da inspeção é guardada em
   `points.classConsolidated`.
2. **Save da inspeção**: `Points.updatePoint` faz `$push` em
   `points.userName` e `points.inspection`. Operação atômica em
   single-document, idempotente do ponto de vista do `$push` (mas sem
   verificação de duplicidade).
3. **Função destrutiva F10**: a tecla F10, no template
   `/admin/temporal`, disparava `Points.correctCampaignAdmin` (também
   acessível via `GET /service/admin/campaign/correct`). Essa função
   percorria todos os pontos da campanha e, sempre que encontrava
   `inspection.length > numInspec`, executava `slice(0, -k)` em
   `userName` e `inspection`. Como "Classificação Automática" ocupa o
   slot 0, o segundo inspetor humano sempre era cortado.
4. **Agravante 1 — `claimNextBlock` fallback**: quando o pool de blocos
   inéditos do inspetor esgotava, o código removia a exclusão `$nin` e
   devolvia qualquer bloco `available`, podendo entregar ao mesmo
   inspetor um round-2 cujo round-1 ele havia feito.
5. **Agravante 2 — `findPointFromBlock`**: o offset do bloco avançava
   ao SERVIR o ponto, não ao salvar. Pontos servidos sem save eram
   "engolidos" — bloco completava sem o `userName` daquele ponto.
6. **Agravante 3 — `releaseExpiredBlocks`**: ao expirar um bloco,
   zerava `currentPointOffset` e descartava o `assignedTo` sem
   snapshot. Próximo inspetor recomeçava do ponto 1, refazendo
   inspeções já salvas individualmente, criando duplicidades que F10
   depois cortava.

## Evidência empírica (cópia do tunelamento prod em 2026-05-09 21h00)

```
mapbiomas_pastagem_col11 — 64.718 pontos totais
Distribuição de userName.length:
  length=1 (apenas auto)             8.515 pontos    (round 1 não iniciado)
  length=2 (auto + 1 humano)        56.134 pontos    (round 1 feito; round 2 perdido OU pendente)
  length=3 (auto + 2 humanos)           69 pontos    (round 2 preservado)

Blocos:
  round=1 completed              12.487
  round=2 available              11.066
  round=2 assigned                   2
  round=2 completed               1.419

Pontos esperados com length=3:    1.419 × 5 = 7.095
Pontos efetivos com length=3:                    69
Inspeções perdidas:                          ~7.026  (99,03 %)
```

Casos individuais auditados:
- Bloco 1422 (pontos 9390–9394): round 1 ana_carolinne, round 2 poliana,
  ambos `completed`. Ponto 9394 sem `poliana` em `userName`.
- Bloco 1423 (pontos 9395–9399): round 1 ana_carolinne, round 2
  felipe.santos, ambos `completed`. Ponto 9398 sem ana_carolinne (round
  1 perdido), ponto 9399 sem felipe.santos.

## Mitigações aplicadas (branch `fix/tvi-correctcampaign-disable-and-defense`)

### Tier 0 — Stop the bleeding

| Mudança | Onde | Efeito |
|---|---|---|
| `correctCampaignAdmin` e `correctCampaign` em dry-run | `src/server/controllers/supervisor.js:794` e `:990` | Endpoints respondem `{dryRun: true, ...}` sem alterar dados |
| Atalho F10 removido + `correctCampain` neutralizada | `src/client/controllers/admin-temporal.js:1135` e `:1158` | Toque acidental em F10 não destrói mais nada |
| `requireSuperAdmin` em `removeInspections` | `src/server/routes/supervisor.js:1` e `:379` | Rota legada agora exige sessão de super-admin |
| Fallback de `claimNextBlock` removido | `src/server/controllers/blocos.js:186` | Inspetor não recebe mais bloco que ele mesmo já fez |

### Tier 1 — Defesa em camadas no schema atual

- Collection `points_audit` append-only (snapshot before/after de toda
  mutação destrutiva sobre `points`). Indexada por `pointId`, `campaignId`,
  `actor.username`, `operation`, `ts`.
- `services/pointsService.js` — wrapper único de mutação:
  `appendInspection`, `softWipePoint`, `removeInspectorByIndex`,
  `setClassConsolidated`, `restore`. Cada operação grava audit antes e
  depois; `appendInspection` rejeita inspetor duplicado com
  `DUPLICATE_INSPECTOR`.
- Schema validator MongoDB em `points`: `userName.length === inspection.length`,
  modo `warn` (loga mas não rejeita; após 1 sprint sem warns trocar para
  `error`). Script: `src/server/scripts/install-points-validator.js`.
- Token de confirmação descartável (60s) + `reason` ≥ 10 chars
  obrigatórios em rotas destrutivas. Middleware:
  `src/server/middleware/destructiveConfirmation.js`. Endpoint:
  `POST /api/admin/destructive-token`. Rotas modernas em
  `src/server/routes/pointsAdmin.js`.
- Soft-delete: `archivedAt`, `archivedReason`, `archivedBy` setados em
  vez de hard-wipe. Restore via `POST /api/admin/points/:pointId/restore`.
- Migração de todos os handlers destrutivos
  (`Points.updatePoint`, `Points.removeInspections`,
  `Points.removeInspectionAdmin`, `Points.updateClassConsolidatedAdmin`,
  `Blocos.discardBlock`) para o `pointsService`.

### Tier 2 — Ownership e integridade do offset (modo sombra)

- `Points.updatePoint` faz ownership check: confirma que existe
  `tvi_blocos` com `assignedTo=user.name`, `status='assigned'` e
  `pointIds` contendo o ponto. **Em modo sombra**: registra warn quando
  falha mas NÃO rejeita o save (escolha conservadora para não travar o
  fluxo do inspetor durante observação).
- `Blocos.advanceBlockOffsetToAtLeast` (novo): chamado por updatePoint
  após save com `slot+1`. Idempotente via `$max`.
- `Blocos.releaseExpiredBlocksInternal`: agora **conserva**
  `currentPointOffset` e grava snapshot em `tvi_blocos_release_log`
  antes de liberar.

### Tier 3 — Operacional

- Backup diário automatizado: `devops/scripts/backup-tvi-daily.sh`
  (cron sugerido às 03:00, retenção 30 dias local).
- Endpoint de monitoramento:
  `GET /api/admin/inspection-health[?campaignId=X]`. Devolve métricas
  por campanha (distribuição `userName.length`, blocks por round/status,
  audit últimas 24h, release log últimas 24h).
- Este documento (registro do incidente).

## Como restaurar inspeções a partir de `points_audit`

Para um ponto específico que foi arquivado por engano via `softWipePoint`:

```bash
# Solicitar token (super-admin):
curl -X POST -b cookies.txt http://localhost:3000/api/admin/destructive-token \
  -H 'Content-Type: application/json' \
  -d '{"intent":"restore","context":{"pointId":"9395_mapbiomas_pastagem_col11"}}'
# → { "token": "abc123...", "expiresIn": 60 }

# Restaurar (dentro de 60s):
curl -X POST -b cookies.txt http://localhost:3000/api/admin/points/9395_mapbiomas_pastagem_col11/restore \
  -H 'Content-Type: application/json' \
  -d '{"confirmationToken":"abc123...","reason":"Recuperação após engano admin"}'
```

O sistema lê o último snapshot `before` em `points_audit` para o ponto
e reaplica `userName`, `inspection`, `classConsolidated`, `archivedAt`.

## Como interpretar `inspection-health`

| Métrica | Esperado | Sinal de alarme |
|---|---|---|
| `points.byUserNameLength` | crescimento gradual em chave `3` (round 2 completando) | queda brusca em chave `3` = uso de função destrutiva |
| `blocks.availableRound2WithPartialPoints` | tende a zero conforme round 2 avança | sustentação alta = inspetores não pegando blocos round-2 ou release frequente |
| `audit.last24h.byOperation.soft_wipe` | zero ou muito baixo (com reason justificada) | qualquer pico = investigar quem chamou e por quê |
| `audit.last24h.byOperation.append_inspection` | proporcional ao volume diário de saves | queda = inspetores não conseguindo salvar |
| `releaseLog.last24h.total` | baixo (timeout 8h só dispara em sessões abandonadas) | pico = bug de sessão ou inspetores não fechando blocos |

## Recuperação dos ~7k pontos perdidos

A perda já foi consumada — o snapshot pré-fix (em
`~/backup/tvi-pre-fix-20260509-2121.archive.gz`) reflete o estado APÓS
a perda. Recuperar requer um backup HISTÓRICO de antes do estrago:

1. Verificar com a infraestrutura LAPIG se existe dump anterior (≤ abril
   de 2026).
2. Se sim, restaurar em ambiente isolado e cruzar com o estado atual
   para identificar pontos que perderam o segundo inspetor; pode ser
   reaplicado seletivamente.
3. Se não, listar os ~1.405 blocos round-2 `completed` cujos pontos têm
   `userName.length < 3` e revertê-los para `available` para
   reinspeção, sinalizando à equipe de inspetores quem fez o round 1
   (para evitar atribuição cruzada manual).

Query para listar:

```js
db.tvi_blocos.aggregate([
  { $match: { campaignId: "mapbiomas_pastagem_col11", inspectionRound: 2, status: "completed" } },
  { $lookup: { from: "points", localField: "pointIds", foreignField: "_id", as: "pts" } },
  { $project: {
      blockIndex: 1, assignedTo: 1, completedAt: 1,
      lostPoints: {
        $filter: { input: "$pts", as: "p", cond: { $lt: [{ $size: { $ifNull: ["$$p.userName", []] } }, 3] } }
      }
  }},
  { $match: { $expr: { $gt: [{ $size: "$lostPoints" }, 0] } } },
  { $project: { blockIndex: 1, assignedTo: 1, completedAt: 1, lostCount: { $size: "$lostPoints" }, lostIds: "$lostPoints._id" } }
])
```

## Itens fora de escopo (registrar para próximas iterações)

- Refatoração para schema append-only (`point_inspections` como
  collection separada com 1 documento por inspeção) — gold standard,
  estimado em 6–10 sprints.
- Migrar UIs antigas (rotas GET destrutivas) para os endpoints POST
  novos com token + reason.
- Subir o schema validator de `warn` para `error` após 1 sprint sem
  warnings.
- Endurecer o ownership check de modo sombra para rejeitar (HTTP 409)
  quando estabilizado.
- Sync semanal do diretório de backup local para storage offsite.

## Referências

- Plano de implementação: `~/.claude/plans/clever-dreaming-pudding.md`
- Diagnóstico técnico completo: `/tmp/tvi-investigation/DIAGNOSTICO.md`
  e demais arquivos `/tmp/tvi-investigation/etapa_*.md`
- Branch contendo as correções: `fix/tvi-correctcampaign-disable-and-defense`
