#!/usr/bin/env node
/**
 * Backfill do campo `userNameCount` em `points` (TKT-000015).
 *
 * Desde TKT-000015, `updatePoint` passa a incrementar `userNameCount` em cada
 * inserção de inspeção para evitar o filtro `$where: 'this.userName.length < N'`
 * (não-indexável) em `findPoint`. Este script popula o campo em pontos legados
 * com `userNameCount: userName.length` para que a consulta principal não caia
 * no branch `$exists: false` da retrocompatibilidade.
 *
 * Uso:
 *   MONGO_HOST=... MONGO_PORT=... MONGO_DATABASE=... node backfill-userNameCount.js [--dry-run] [--campaign=<id>]
 *
 * NÃO é invocado automaticamente. Operação idempotente: documentos já populados
 * são ignorados.
 */

'use strict';

var MongoClient = require('mongodb').MongoClient;

var DRY_RUN = process.argv.indexOf('--dry-run') !== -1;
var campaignArg = process.argv.find(function (a) { return a.indexOf('--campaign=') === 0; });
var CAMPAIGN_FILTER = campaignArg ? campaignArg.split('=')[1] : null;

var host = process.env.MONGO_HOST || '127.0.0.1';
var port = process.env.MONGO_PORT || '27017';
var dbname = process.env.MONGO_DATABASE || 'tvi';

var url = 'mongodb://' + host + ':' + port + '/' + dbname;

MongoClient.connect(url, function (err, db) {
	if (err) {
		console.error('Falha ao conectar ao MongoDB:', err.message);
		process.exit(1);
	}
	var points = db.collection('points');
	var filter = { userNameCount: { $exists: false } };
	if (CAMPAIGN_FILTER) filter.campaign = CAMPAIGN_FILTER;

	console.log('[backfill-userNameCount] filtro:', JSON.stringify(filter), 'dry-run=', DRY_RUN);

	points.find(filter, { _id: 1, userName: 1 }).toArray(function (e, docs) {
		if (e) {
			console.error('Erro ao listar pontos:', e.message);
			db.close();
			process.exit(1);
		}
		console.log('[backfill-userNameCount] pontos elegíveis:', docs.length);
		var updated = 0;
		function step(i) {
			if (i >= docs.length) {
				console.log('[backfill-userNameCount] done. updated=' + updated);
				db.close();
				return;
			}
			var d = docs[i];
			var count = Array.isArray(d.userName) ? d.userName.length : 0;
			if (DRY_RUN) {
				console.log('[dry] ' + d._id + ' → userNameCount=' + count);
				return step(i + 1);
			}
			points.updateOne({ _id: d._id }, { $set: { userNameCount: count } }, function (eu, r) {
				if (!eu && r && r.modifiedCount) updated++;
				step(i + 1);
			});
		}
		step(0);
	});
});
