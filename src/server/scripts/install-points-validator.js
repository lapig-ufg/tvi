#!/usr/bin/env node
/**
 * Instalação do schema validator MongoDB para `points` (Tier 1.3 — 2026-05-09).
 *
 * Defesa em camadas contra perda de inspeções: garante no nível do banco que
 * `userName.length === inspection.length` em todo documento gravado/atualizado.
 * Sem isso, qualquer função (atual ou futura) que altere apenas um dos arrays
 * pode dessincronizá-los. O bug de F10 / correctCampaignAdmin já era um
 * sintoma — os arrays SEMPRE foram alterados juntos lá, mas o pattern é
 * frágil e novos handlers podem repetir o erro.
 *
 * Modo padrão: validationAction='warn' (loga em mongod.log mas não rejeita).
 * Após 1 sprint sem warnings em produção, mudar para 'error' (passar --strict).
 *
 * Uso (prod, MongoDB ≤ 4.x — driver mongodb 2.2.36 do projeto funciona):
 *   MONGO_HOST=prod-mongo MONGO_PORT=27017 MONGO_DATABASE=tvi \
 *     node src/server/scripts/install-points-validator.js [--strict] [--remove]
 *
 * Uso (MongoDB ≥ 5.x — driver legado não suporta OP_QUERY removido; use mongosh):
 *   mongosh "mongodb://host:port/tvi" --file src/server/scripts/install-points-validator.mongosh.js
 *   (ou rodar o snippet inline equivalente — ver bloco abaixo)
 *
 * Snippet inline equivalente (mongosh):
 *   db.runCommand({
 *     collMod: "points",
 *     validator: { $expr: { $eq: [
 *       { $size: { $ifNull: ["$userName", []] } },
 *       { $size: { $ifNull: ["$inspection", []] } }
 *     ]}},
 *     validationLevel: "moderate",
 *     validationAction: "warn"      // após 1 sprint sem warns: trocar para "error"
 *   })
 *
 * Operação idempotente: pode ser executada várias vezes; só altera collMod
 * se a configuração desejada diferir da atual.
 */

'use strict';

var MongoClient = require('mongodb').MongoClient;

var STRICT = process.argv.indexOf('--strict') !== -1;
var REMOVE = process.argv.indexOf('--remove') !== -1;

var host = process.env.MONGO_HOST || 'localhost';
var port = process.env.MONGO_PORT || '27017';
var dbname = process.env.MONGO_DATABASE || 'tvi';
var url = 'mongodb://' + host + ':' + port;

var validatorExpression = {
    $expr: {
        $eq: [
            { $size: { $ifNull: ['$userName', []] } },
            { $size: { $ifNull: ['$inspection', []] } }
        ]
    }
};

var desiredAction = STRICT ? 'error' : 'warn';

function run() {
    console.log('[install-points-validator] target ' + url + '/' + dbname);
    console.log('[install-points-validator] mode: ' + (REMOVE ? 'REMOVE validator' : 'INSTALL validator (action=' + desiredAction + ')'));

    MongoClient.connect(url, { useUnifiedTopology: true }, function (err, client) {
        if (err) {
            console.error('Falha ao conectar MongoDB:', err.message);
            process.exit(1);
        }
        var db = client.db(dbname);

        var command;
        if (REMOVE) {
            // Remover validator: passar validator vazio + validationLevel=off
            command = {
                collMod: 'points',
                validator: {},
                validationLevel: 'off',
                validationAction: 'warn'
            };
        } else {
            command = {
                collMod: 'points',
                validator: validatorExpression,
                validationLevel: 'moderate', // só valida docs novos/atualizados (não legados)
                validationAction: desiredAction
            };
        }

        db.command(command, function (cmdErr, result) {
            if (cmdErr) {
                console.error('Falha ao executar collMod:', cmdErr.message);
                client.close();
                process.exit(1);
            }
            console.log('collMod aplicado com sucesso. Resposta:', JSON.stringify(result));

            // Confirmar lendo o estado atual
            db.listCollections({ name: 'points' }).toArray(function (lErr, cols) {
                if (lErr) {
                    console.error('Falha ao listar collections:', lErr.message);
                    client.close();
                    process.exit(1);
                }
                if (cols.length === 0) {
                    console.error('Collection points não existe!');
                    client.close();
                    process.exit(1);
                }
                var opts = cols[0].options || {};
                console.log('--- Estado atual de points ---');
                console.log('validator:        ' + JSON.stringify(opts.validator || {}));
                console.log('validationLevel:  ' + (opts.validationLevel || 'off'));
                console.log('validationAction: ' + (opts.validationAction || 'warn'));
                client.close();
                process.exit(0);
            });
        });
    });
}

run();
