/**
 * WaybackGridCore — núcleo puro da grade Wayback (sem Angular/Leaflet).
 *
 * UMD mínimo: no browser registra window.WaybackGridCore (consumido por
 * waybackGridService e pelos controllers); em Node exporta via module.exports
 * (consumido pelos testes em src/server/test/waybackGridCore.test.js).
 * ES5 por compatibilidade com o restante do client (AngularJS 1.5.8).
 */
(function (global) {
    'use strict';

    var WaybackGridCore = {

        displayDate: function (img) {
            return img.captureDate || img.releaseDate;
        },

        leafletUrl: function (itemURL) {
            return String(itemURL)
                .replace('{level}', '{z}')
                .replace('{row}', '{y}')
                .replace('{col}', '{x}');
        },

        buildGrid: function (point, config, releasesIndex) {
            var images = (point && point.waybackImages) || [];
            var initialYear = config && config.initialYear;
            var finalYear = config && config.finalYear;
            var sorted = images.slice().sort(function (a, b) {
                return WaybackGridCore.displayDate(a).localeCompare(WaybackGridCore.displayDate(b));
            });
            var grid = [];
            sorted.forEach(function (img) {
                var date = WaybackGridCore.displayDate(img);
                var year = parseInt(date.slice(0, 4), 10);
                if (initialYear && year < initialYear) return;
                if (finalYear && year > finalYear) return;
                var release = releasesIndex && releasesIndex[img.releaseNum];
                grid.push({
                    date: date,
                    approximateDate: !img.captureDate,
                    year: year,
                    releaseNum: img.releaseNum,
                    url: release ? WaybackGridCore.leafletUrl(release.itemURL) : null,
                    bounds: point.bounds,
                    index: grid.length
                });
            });
            return grid;
        },

        buildInitialAnswers: function (grid, defaultLandUse) {
            if (!grid || !grid.length) return [];
            return [{
                initialDate: grid[0].date,
                finalDate: grid[grid.length - 1].date,
                landUse: defaultLandUse || '',
                pixelBorder: false
            }];
        },

        optionDates: function (grid, fromDate) {
            return (grid || [])
                .map(function (g) { return g.date; })
                .filter(function (d) { return !fromDate || d >= fromDate; });
        },

        // Datas ISO (YYYY-MM-DD) formatadas por manipulação de string:
        // new Date('2012-09-22') é interpretado como meia-noite UTC e, em
        // fusos negativos (todo o Brasil), getDate() recua a data em 1 dia.
        // Entradas fora do padrão ISO retornam null (o caller aplica o
        // tratamento legado).
        formatDateBR: function (dateString) {
            var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateString || ''));
            if (!m) return null;
            return m[3] + '/' + m[2] + '/' + m[1];
        },

        // Entradas do seletor de datas do formulário: datas deduplicadas,
        // rotuladas com a posição 1-based das células correspondentes na
        // grade ("2012-09-22 (3-5)"), para o inspetor correlacionar sem
        // contar imagens. value continua sendo a data pura — o formato das
        // respostas persistidas não muda. O filtro fromDate espelha o de
        // optionDates e preserva a numeração global (a posição na grade não
        // depende da caixa de resposta que está listando).
        optionEntries: function (grid, fromDate) {
            var groups = [];
            (grid || []).forEach(function (g) {
                var last = groups[groups.length - 1];
                if (last && last.value === g.date) {
                    last.to = g.index + 1;
                } else {
                    groups.push({ value: g.date, from: g.index + 1, to: g.index + 1 });
                }
            });
            return groups
                .filter(function (e) { return !fromDate || e.value >= fromDate; })
                .map(function (e) {
                    var range = e.from === e.to ? String(e.from) : e.from + '-' + e.to;
                    return { value: e.value, label: e.value + ' (' + range + ')' };
                });
        },

        expandAnswersToForm: function (answers, grid) {
            return (grid || []).map(function (g) {
                var match = null;
                for (var i = 0; i < (answers || []).length; i++) {
                    if (g.date >= answers[i].initialDate && g.date <= answers[i].finalDate) {
                        match = answers[i];
                        break;
                    }
                }
                return {
                    releaseNum: g.releaseNum,
                    captureDate: g.date,
                    landUse: match ? (match.landUse || null) : null,
                    pixelBorder: match ? !!match.pixelBorder : false
                };
            });
        }
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = WaybackGridCore;
    }
    if (global) {
        global.WaybackGridCore = WaybackGridCore;
    }
})(typeof window !== 'undefined' ? window : null);
