/**
 * Helper puro para cálculo de janelas semanais (weekly buckets).
 *
 * Introduzido em TKT-000008 e reutilizado em TKT-000009 e TKT-000013.
 *
 * Uma "semana" é definida por três parâmetros configuráveis por campanha
 * (ver `campaign.weeklyGoalConfig`):
 *   - `closingDayOfWeek`: dia da semana de fechamento (0 = domingo ... 6 = sábado)
 *   - `closingHour`: hora (0-23) do fechamento no fuso horário da campanha
 *   - `timezone`: IANA tz database (ex.: 'America/Sao_Paulo')
 *
 * A semana que se encerra em `closingDayOfWeek closingHour:00` no fuso `timezone`
 * é a janela `[weekStart, weekEnd)`, onde `weekEnd = <próximo closingDay/hora>` e
 * `weekStart = weekEnd - 7 dias`. Operamos sempre em UTC internamente
 * para evitar erros de horário de verão; a conversão "local → UTC" usa
 * `Intl.DateTimeFormat` (dependência zero — já disponível no Node moderno).
 *
 * A correção de timezone é aproximada em DST: o offset é calculado no instante
 * de `reference` e aplicado ao limite. Para as campanhas atuais (BRT, sem DST)
 * isso é exato; em timezones com DST, pode haver defasagem de 1h nas bordas
 * das semanas em que ocorre a transição — aceitável para efeitos de meta.
 */

'use strict';

var DEFAULT_CONFIG = {
	closingDayOfWeek: 1, // segunda-feira
	closingHour: 12,     // meio-dia
	timezone: 'America/Sao_Paulo'
};

function normalizeConfig(config) {
	var cfg = config || {};
	var closingDayOfWeek = Number.isInteger(cfg.closingDayOfWeek) ? cfg.closingDayOfWeek : DEFAULT_CONFIG.closingDayOfWeek;
	var closingHour = Number.isInteger(cfg.closingHour) ? cfg.closingHour : DEFAULT_CONFIG.closingHour;
	var timezone = (typeof cfg.timezone === 'string' && cfg.timezone.length > 0) ? cfg.timezone : DEFAULT_CONFIG.timezone;

	// Defesa: cair no default se valores forem absurdos (evita crash por config corrompida).
	if (closingDayOfWeek < 0 || closingDayOfWeek > 6) closingDayOfWeek = DEFAULT_CONFIG.closingDayOfWeek;
	if (closingHour < 0 || closingHour > 23) closingHour = DEFAULT_CONFIG.closingHour;

	return { closingDayOfWeek: closingDayOfWeek, closingHour: closingHour, timezone: timezone };
}

function isValidTimezone(tz) {
	try {
		// eslint-disable-next-line no-new
		new Intl.DateTimeFormat('en-US', { timeZone: tz });
		return true;
	} catch (e) {
		return false;
	}
}

/**
 * Retorna o offset (em minutos) do timezone informado relativo ao UTC
 * no instante `date`. Ex.: America/Sao_Paulo em horário padrão → -180 (UTC-3).
 */
function getTimezoneOffsetMinutes(date, timezone) {
	var dtf = new Intl.DateTimeFormat('en-US', {
		timeZone: timezone,
		hour12: false,
		year: 'numeric', month: '2-digit', day: '2-digit',
		hour: '2-digit', minute: '2-digit', second: '2-digit'
	});
	var parts = dtf.formatToParts(date);
	var map = {};
	for (var i = 0; i < parts.length; i++) {
		if (parts[i].type !== 'literal') map[parts[i].type] = parts[i].value;
	}
	// Algumas engines retornam hour "24" em vez de "00" na meia-noite; corrigir.
	var hour = parseInt(map.hour, 10);
	if (hour === 24) hour = 0;

	var asUtc = Date.UTC(
		parseInt(map.year, 10),
		parseInt(map.month, 10) - 1,
		parseInt(map.day, 10),
		hour,
		parseInt(map.minute, 10),
		parseInt(map.second, 10)
	);
	return Math.round((asUtc - date.getTime()) / 60000);
}

/**
 * Calcula o instante UTC que corresponde ao fim da semana que contém `reference`.
 * `reference` é Date; devolve outro Date em UTC.
 */
function getWeekEndUtc(reference, config) {
	var cfg = normalizeConfig(config);
	var offsetMin = getTimezoneOffsetMinutes(reference, cfg.timezone);

	// Reinterpreta `reference` como componentes de data no fuso local.
	var localMs = reference.getTime() + offsetMin * 60000;
	var local = new Date(localMs);

	var localDow = local.getUTCDay(); // 0..6 porque local está em "UTC shifted"
	var localHour = local.getUTCHours();
	var localMinute = local.getUTCMinutes();
	var localSecond = local.getUTCSeconds();
	var localMs2 = local.getUTCMilliseconds();

	// Quantos dias até o próximo `closingDayOfWeek closingHour:00` (inclusive hoje se ainda não passou).
	var daysAhead = (cfg.closingDayOfWeek - localDow + 7) % 7;
	var sameDayButAfterClose = (daysAhead === 0) && (
		localHour > cfg.closingHour ||
		(localHour === cfg.closingHour && (localMinute > 0 || localSecond > 0 || localMs2 > 0))
	);
	if (sameDayButAfterClose) daysAhead = 7;

	// Constrói a data-alvo local (closingDay às closingHour:00:00.000).
	var targetLocal = new Date(localMs);
	targetLocal.setUTCDate(targetLocal.getUTCDate() + daysAhead);
	targetLocal.setUTCHours(cfg.closingHour, 0, 0, 0);

	// Converte de volta para UTC usando o offset no instante alvo (corrige DST entre hoje e o alvo).
	var approxUtc = new Date(targetLocal.getTime() - offsetMin * 60000);
	var offsetAtTarget = getTimezoneOffsetMinutes(approxUtc, cfg.timezone);
	if (offsetAtTarget !== offsetMin) {
		approxUtc = new Date(targetLocal.getTime() - offsetAtTarget * 60000);
	}
	return approxUtc;
}

/**
 * Retorna os limites da semana que contém `reference`.
 * `start` inclusivo, `end` exclusivo; intervalo de exatos 7 dias.
 */
function getWeekBounds(reference, config) {
	var ref = reference instanceof Date ? reference : new Date(reference);
	var end = getWeekEndUtc(ref, config);
	var start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
	return { start: start, end: end };
}

/**
 * Retorna um array ordenado (mais antigo → mais recente) com os limites das
 * últimas `numWeeks` semanas, terminando na semana que contém `reference`.
 */
function getLastNWeeks(reference, numWeeks, config) {
	var n = Math.max(1, parseInt(numWeeks, 10) || 1);
	var result = [];
	var ref = reference instanceof Date ? reference : new Date(reference);
	var anchor = getWeekBounds(ref, config);
	result.push(anchor);
	var cursor = anchor.start;
	for (var i = 1; i < n; i++) {
		var end = cursor;
		var start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
		result.unshift({ start: start, end: end });
		cursor = start;
	}
	return result;
}

/**
 * Indica em qual bucket (0-based) `fillDate` se encaixa, dada uma lista de janelas
 * retornadas por `getLastNWeeks`. Retorna -1 se `fillDate` não cair em nenhuma janela.
 */
function bucketize(fillDate, buckets) {
	if (!fillDate) return -1;
	var ts = fillDate instanceof Date ? fillDate.getTime() : new Date(fillDate).getTime();
	if (isNaN(ts)) return -1;
	for (var i = 0; i < buckets.length; i++) {
		var b = buckets[i];
		if (ts >= b.start.getTime() && ts < b.end.getTime()) return i;
	}
	return -1;
}

/**
 * Constrói uma chave canônica para persistir progresso por semana.
 * Formato: `<userName>__<campaign>__<ISOstart>`.
 */
function buildWeekKey(userName, campaignId, weekStart) {
	var iso = weekStart instanceof Date ? weekStart.toISOString() : new Date(weekStart).toISOString();
	return String(userName) + '__' + String(campaignId) + '__' + iso;
}

/**
 * Formata o rótulo humanizado de uma semana ("23/03 - 30/03").
 */
function formatWeekLabel(bounds, timezone) {
	var tz = (typeof timezone === 'string' && timezone.length > 0) ? timezone : DEFAULT_CONFIG.timezone;
	try {
		var fmt = new Intl.DateTimeFormat('pt-BR', {
			timeZone: tz,
			day: '2-digit',
			month: '2-digit'
		});
		return fmt.format(bounds.start) + ' - ' + fmt.format(bounds.end);
	} catch (e) {
		return bounds.start.toISOString().slice(0, 10) + ' - ' + bounds.end.toISOString().slice(0, 10);
	}
}

module.exports = {
	DEFAULT_CONFIG: DEFAULT_CONFIG,
	normalizeConfig: normalizeConfig,
	isValidTimezone: isValidTimezone,
	getWeekBounds: getWeekBounds,
	getLastNWeeks: getLastNWeeks,
	bucketize: bucketize,
	buildWeekKey: buildWeekKey,
	formatWeekLabel: formatWeekLabel
};
