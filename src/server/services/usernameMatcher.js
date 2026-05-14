'use strict';

/**
 * usernameMatcher
 *
 * Detecta similaridade entre um nome digitado no login e nomes já cadastrados
 * em uma campanha do TVI (collection `points.userName`).
 *
 * Combina três níveis de comparação:
 *   1. Match exato (string === string)         → tipo "exact"
 *   2. Match após normalização canônica         → tipo "normalized"
 *      (caso/separadores/acentos)
 *   3. Distância de edição (Levenshtein)        → tipo "fuzzy"
 *      sobre os nomes normalizados, com limite
 *      proporcional ao comprimento.
 *
 * Implementação intencionalmente sem dependências externas: a auditoria
 * de nomes do banco mostra que campanhas têm no máximo ~30 inspetores
 * distintos, então O(n·m) é trivial.
 */

const SYSTEM_USERS = new Set([
	'Classificação Automática',
	'Clasificação Anterior',
	'Classificação Anterior',
	'Exportacion_puntos'
]);

const COMBINING_MARKS_REGEX = /[̀-ͯ]/g;
const SEPARATORS_REGEX = /[\s._\-,]/g;

function normalize(value) {
	if (value === null || value === undefined) {
		return '';
	}
	return String(value)
		.normalize('NFD')
		.replace(COMBINING_MARKS_REGEX, '')
		.toLowerCase()
		.replace(SEPARATORS_REGEX, '');
}

function levenshtein(a, b) {
	if (a === b) return 0;
	if (!a) return b.length;
	if (!b) return a.length;

	const m = a.length;
	const n = b.length;
	let prev = new Array(n + 1);
	let curr = new Array(n + 1);

	for (let j = 0; j <= n; j++) prev[j] = j;

	for (let i = 1; i <= m; i++) {
		curr[0] = i;
		const ai = a.charCodeAt(i - 1);
		for (let j = 1; j <= n; j++) {
			const cost = ai === b.charCodeAt(j - 1) ? 0 : 1;
			curr[j] = Math.min(
				curr[j - 1] + 1,
				prev[j] + 1,
				prev[j - 1] + cost
			);
		}
		const tmp = prev;
		prev = curr;
		curr = tmp;
	}

	return prev[n];
}

function fuzzyLimit(len) {
	if (len <= 5) return 1;
	if (len <= 10) return 2;
	return 3;
}

function sanitizeCandidates(candidates) {
	const seen = new Set();
	const out = [];
	for (const c of candidates) {
		if (c === null || c === undefined) continue;
		const s = String(c).trim();
		if (s === '') continue;
		if (SYSTEM_USERS.has(s)) continue;
		if (seen.has(s)) continue;
		seen.add(s);
		out.push(s);
	}
	return out;
}

/**
 * @param {string} input              Nome digitado no form.
 * @param {Array<string>} candidates  Nomes já cadastrados na campanha.
 * @param {object} [opts]
 * @param {number} [opts.maxSuggestions=5]
 * @returns {{ status: 'exact'|'similar'|'new', suggestions: string[] }}
 */
function findSimilarUsernames(input, candidates, opts) {
	const maxSuggestions = (opts && opts.maxSuggestions) || 5;

	if (input === null || input === undefined || String(input).trim() === '') {
		return { status: 'new', suggestions: [] };
	}

	const rawInput = String(input);
	const trimmedInput = rawInput.trim();
	const normInput = normalize(rawInput);
	const cleaned = sanitizeCandidates(candidates || []);

	const matches = [];
	let hasExact = false;

	for (const c of cleaned) {
		if (c === rawInput || c === trimmedInput) {
			hasExact = true;
			break;
		}

		const normC = normalize(c);
		if (normInput === normC) {
			matches.push({ value: c, type: 'normalized', distance: 0, lengthDelta: Math.abs(c.length - rawInput.length) });
			continue;
		}

		const limit = fuzzyLimit(Math.max(normInput.length, normC.length));
		if (Math.abs(normInput.length - normC.length) > limit) continue;

		const distance = levenshtein(normInput, normC);
		if (distance <= limit) {
			matches.push({ value: c, type: 'fuzzy', distance, lengthDelta: Math.abs(c.length - rawInput.length) });
		}
	}

	if (hasExact) {
		return { status: 'exact', suggestions: [] };
	}

	if (matches.length === 0) {
		return { status: 'new', suggestions: [] };
	}

	matches.sort(function (a, b) {
		if (a.type !== b.type) return a.type === 'normalized' ? -1 : 1;
		if (a.distance !== b.distance) return a.distance - b.distance;
		return a.lengthDelta - b.lengthDelta;
	});

	const suggestions = matches.slice(0, maxSuggestions).map(function (m) { return m.value; });
	return { status: 'similar', suggestions: suggestions };
}

module.exports = {
	normalize: normalize,
	levenshtein: levenshtein,
	findSimilarUsernames: findSimilarUsernames,
	SYSTEM_USERS: SYSTEM_USERS
};
