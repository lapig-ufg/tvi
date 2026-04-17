#!/usr/bin/env node
/**
 * Backfill de `classConsolidatedOriginal` para pontos editados antes de TKT-000013.
 *
 * Contexto: antes desta alteração, a edição do supervisor em `/supervisor`
 * sobrescrevia `classConsolidated` sem preservar o valor original (calculado por
 * maioria entre intérpretes). Para documentos legados com `pointEdited: true`
 * e sem `classConsolidatedOriginal`, recalculamos o veredito majoritário a partir
 * de `inspection[].form[].landUse` e gravamos o resultado apenas no campo novo,
 * sem alterar `classConsolidated` (valor do supervisor).
 *
 * Uso:
 *   MONGO_HOST=... MONGO_PORT=... MONGO_DATABASE=... node backfill-class-original.js [--dry-run] [--campaign=<id>]
 *
 * NÃO é invocado automaticamente. Rodar em janela de manutenção com backup prévio.
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

function computeConsolidated(point, campaign) {
	var landUseByYear = {};
	if (!Array.isArray(point.inspection)) return [];
	for (var i = 0; i < point.inspection.length; i++) {
		var insp = point.inspection[i];
		if (!insp || !Array.isArray(insp.form)) continue;
		for (var j = 0; j < insp.form.length; j++) {
			var f = insp.form[j];
			if (!f || typeof f.initialYear !== 'number' || typeof f.finalYear !== 'number') continue;
			for (var y = f.initialYear; y <= f.finalYear; y++) {
				if (!landUseByYear[y]) landUseByYear[y] = [];
				landUseByYear[y].push(f.landUse);
			}
		}
	}

	var result = [];
	var numInspec = (campaign && campaign.numInspec) || point.userName.length || 1;
	for (var year = campaign.initialYear; year <= campaign.finalYear; year++) {
		var votes = {};
		var arr = landUseByYear[year] || [];
		for (var k = 0; k < arr.length; k++) {
			votes[arr[k]] = (votes[arr[k]] || 0) + 1;
		}
		var consolidated = null;
		var keys = Object.keys(votes);
		for (var kk = 0; kk < keys.length; kk++) {
			if (votes[keys[kk]] > numInspec / 2) {
				consolidated = keys[kk];
				break;
			}
		}
		result.push(consolidated || 'Não consolidado');
	}
	return result;
}

MongoClient.connect(url, function (err, db) {
	if (err) {
		console.error('Falha ao conectar ao MongoDB:', err.message);
		process.exit(1);
	}

	var campaigns = db.collection('campaign');
	var points = db.collection('points');

	var filter = {
		pointEdited: true,
		classConsolidatedOriginal: { $exists: false }
	};
	if (CAMPAIGN_FILTER) filter.campaign = CAMPAIGN_FILTER;

	console.log('[backfill] filtro:', JSON.stringify(filter), 'dry-run=', DRY_RUN);

	points.find(filter).toArray(function (errFind, docs) {
		if (errFind) {
			console.error('Falha ao listar pontos:', errFind.message);
			db.close();
			process.exit(1);
		}
		console.log('[backfill] pontos elegíveis:', docs.length);

		var campaignCache = {};
		var processed = 0;
		var updated = 0;

		function loadCampaign(id, cb) {
			if (campaignCache[id]) return cb(null, campaignCache[id]);
			campaigns.findOne({ _id: id }, function (e, c) {
				if (!e && c) campaignCache[id] = c;
				cb(e, c);
			});
		}

		function step(i) {
			if (i >= docs.length) {
				console.log('[backfill] done.', { processed: processed, updated: updated });
				db.close();
				return;
			}
			var doc = docs[i];
			loadCampaign(doc.campaign, function (e, campaign) {
				processed++;
				if (e || !campaign) {
					console.warn('[backfill] campanha ausente/invalid para ponto', doc._id);
					return step(i + 1);
				}
				var original = computeConsolidated(doc, campaign);
				if (DRY_RUN) {
					console.log('[backfill][dry] ' + doc._id + ' → ' + JSON.stringify(original).slice(0, 120));
					return step(i + 1);
				}
				points.updateOne(
					{ _id: doc._id, classConsolidatedOriginal: { $exists: false } },
					{ $set: { classConsolidatedOriginal: original } },
					function (errU, r) {
						if (errU) console.error('[backfill] erro em ' + doc._id + ':', errU.message);
						else if (r.modifiedCount) updated++;
						step(i + 1);
					}
				);
			});
		}

		step(0);
	});
});
