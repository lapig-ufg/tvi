#!/usr/bin/env bash
# simulate/inspect-results.sh
# Queries pré-prontas para o usuário inspecionar o estado de tvi_sim
# após uma execução da simulação. Não muta nada.

set -euo pipefail

DB="${TVI_SIM_DB:-tvi_sim}"
CAMPAIGN="${TVI_SIM_CAMPAIGN:-simulation_test_campaign}"

mongosh "mongodb://localhost:27019/${DB}" --quiet --eval "
const camp = '${CAMPAIGN}';
print('===================================================================');
print('INSPEÇÃO DA SIMULAÇÃO — banco=${DB}  campanha=' + camp);
print('===================================================================');

print('\n--- (1) Distribuição de userName.length em points ---');
print('       (esperado pós-simulação: 500 com length=3)');
printjson(db.points.aggregate([
  {\$match: {campaign: camp}},
  {\$project: {len: {\$size: {\$ifNull: ['\$userName', []]}}}},
  {\$group: {_id: '\$len', n: {\$sum: 1}}},
  {\$sort: {_id: 1}}
]).toArray());

print('\n--- (2) Pontos com userName.length > 3 (FALHA SE > 0) ---');
print(db.points.countDocuments({campaign: camp, \$expr: {\$gt: [{\$size: {\$ifNull: ['\$userName', []]}}, 3]}}));

print('\n--- (3) Pontos com userName.length != inspection.length (FALHA SE > 0) ---');
print(db.points.countDocuments({
  campaign: camp,
  \$expr: {\$ne: [{\$size: {\$ifNull: ['\$userName', []]}}, {\$size: {\$ifNull: ['\$inspection', []]}}]}
}));

print('\n--- (4) Blocos por (round, status) ---');
printjson(db.tvi_blocos.aggregate([
  {\$match: {campaignId: camp}},
  {\$group: {_id: {round: '\$inspectionRound', status: '\$status'}, n: {\$sum: 1}}},
  {\$sort: {'_id.round': 1, '_id.status': 1}}
]).toArray());

print('\n--- (5) Top 10 inspetores por número de blocos completados ---');
printjson(db.tvi_blocos.aggregate([
  {\$match: {campaignId: camp, status: 'completed'}},
  {\$group: {_id: '\$assignedTo', n: {\$sum: 1}}},
  {\$sort: {n: -1}},
  {\$limit: 10}
]).toArray());

print('\n--- (6) Audit log: distribuição por operation ---');
printjson(db.points_audit.aggregate([
  {\$match: {campaignId: camp}},
  {\$group: {_id: '\$operation', n: {\$sum: 1}}},
  {\$sort: {n: -1}}
]).toArray());

print('\n--- (7) Audit log: top 10 actors por número de operations ---');
printjson(db.points_audit.aggregate([
  {\$match: {campaignId: camp}},
  {\$group: {_id: '\$actor.username', n: {\$sum: 1}}},
  {\$sort: {n: -1}},
  {\$limit: 10}
]).toArray());

print('\n--- (8) tvi_blocos_release_log (timeouts) ---');
print('       total: ' + db.tvi_blocos_release_log.countDocuments({campaignId: camp}));
db.tvi_blocos_release_log.find({campaignId: camp}, {previousAssignedTo:1, previousOffset:1, blockIndex:1, expiredAt:1, releaseReason:1}).limit(5).forEach(printjson);

print('\n--- (9) Logs (warn de shadow ownership, se houver) ---');
print('       count: ' + db.logs.countDocuments({'metadata.campaignId': camp, level: 'warn'}));
db.logs.find({level: 'warn', message: /Tier 2.1 shadow/}).sort({timestamp: -1}).limit(3).forEach(l => print('  ' + l.timestamp + '  ' + l.message + '  meta=' + JSON.stringify(l.metadata)));

print('\n--- (10) Pontos arquivados (softWipePoint) ---');
print('       count: ' + db.points.countDocuments({campaign: camp, archivedAt: {\$ne: null}}));

print('\n===================================================================');
print('Para mais: mongosh \"mongodb://localhost:27019/${DB}\"');
print('===================================================================');
"
