export type Rating = 'again' | 'hard' | 'good' | 'easy'

export type CardState = {
	cardId: number
	status: 'new' | 'learning' | 'review'
	ease: number // ease factor (EF)
	intervalDays: number
	dueAt: number // ms timestamp
	stepIndex: number
	reps: number
	lapses: number
}

export type DeckState = {
	cardStates: Record<number, CardState>
	statsByDay: Record<string, { studied: number }>
	dailyTarget: number
}

export type SchedulerConfig = {
	initialEase: number
	minEase: number
	learningStepsMinutes: number[]
	graduatingIntervalDays: number
	easyBonus: number
}

export const defaultConfig: SchedulerConfig = {
	initialEase: 2.5,
	minEase: 1.3,
	learningStepsMinutes: [1, 10],
	graduatingIntervalDays: 1,
	easyBonus: 1.3,
}

const DAY_MS = 24 * 60 * 60 * 1000

function todayKey(date = new Date()): string {
	const y = date.getFullYear()
	const m = String(date.getMonth() + 1).padStart(2, '0')
	const d = String(date.getDate()).padStart(2, '0')
	return `${y}-${m}-${d}`
}

function storageKey(deckFullName: string): string {
	return `anki-sched::${deckFullName}`
}

export function loadDeckState(deckFullName: string, knownCardIds: number[], defaultDailyTarget = 20): DeckState {
	const raw = localStorage.getItem(storageKey(deckFullName))
	let state: DeckState
	if (raw) {
		try {
			state = JSON.parse(raw) as DeckState
		} catch {
			state = { cardStates: {}, statsByDay: {}, dailyTarget: defaultDailyTarget }
		}
	} else {
		state = { cardStates: {}, statsByDay: {}, dailyTarget: defaultDailyTarget }
	}
	// Initialize missing card states
	for (const id of knownCardIds) {
		if (!state.cardStates[id]) {
			state.cardStates[id] = {
				cardId: id,
				status: 'new',
				ease: defaultConfig.initialEase,
				intervalDays: 0,
				dueAt: Date.now(),
				stepIndex: 0,
				reps: 0,
				lapses: 0,
			}
		}
	}
	return state
}

export function saveDeckState(deckFullName: string, state: DeckState): void {
	localStorage.setItem(storageKey(deckFullName), JSON.stringify(state))
}

export function getNextDueCardId(_deckFullName: string, state: DeckState, deckCardIds: number[], now = Date.now()): number | null {
	const tKey = todayKey(new Date(now))
	const studiedToday = state.statsByDay[tKey]?.studied ?? 0
	if (studiedToday >= state.dailyTarget) return null

	const learningDue: number[] = []
	const learningFuture: Array<{ id: number; dueAt: number }> = []
	const review: number[] = []
	const fresh: number[] = []
	for (const id of deckCardIds) {
		const cs = state.cardStates[id]
		if (!cs) continue
		if (cs.status === 'learning') {
			if (cs.dueAt <= now) learningDue.push(id)
			else learningFuture.push({ id, dueAt: cs.dueAt })
		} else if (cs.status === 'review' && cs.dueAt <= now) review.push(id)
		else if (cs.status === 'new') fresh.push(id)
	}
	if (learningDue.length) return pickStable(learningDue)
	if (review.length) return pickStable(review)
	if (learningFuture.length) {
		learningFuture.sort((a, b) => a.dueAt - b.dueAt)
		return learningFuture[0].id
	}
	if (fresh.length) return pickStable(fresh)
	return null
}

function pickStable(ids: number[]): number {
	// Stable selection: smallest id to keep order deterministic
	return ids.slice().sort((a, b) => a - b)[0]
}

export function applyAnswer(state: DeckState, cardId: number, rating: Rating, now = Date.now(), cfg: SchedulerConfig = defaultConfig): void {
	const cs = state.cardStates[cardId]
	if (!cs) return
	cs.reps += 1
	const steps = cfg.learningStepsMinutes
	if (cs.status === 'new' || cs.status === 'learning') {
		if (rating === 'again') {
			cs.status = 'learning'
			cs.stepIndex = 0
			cs.dueAt = now + steps[0] * 60 * 1000
			return recordStudy(state, now)
		}
		if (rating === 'hard') {
			cs.status = 'learning'
			cs.stepIndex = Math.max(0, cs.stepIndex)
			const mins = Math.ceil((steps[cs.stepIndex] ?? steps[0]) * 1.5)
			cs.dueAt = now + mins * 60 * 1000
			return recordStudy(state, now)
		}
		if (rating === 'good') {
			cs.stepIndex += 1
			if (cs.stepIndex < steps.length) {
				cs.status = 'learning'
				cs.dueAt = now + steps[cs.stepIndex] * 60 * 1000
			} else {
				cs.status = 'review'
				cs.intervalDays = Math.max(1, cfg.graduatingIntervalDays)
				cs.dueAt = now + cs.intervalDays * DAY_MS
			}
			return recordStudy(state, now)
		}
		if (rating === 'easy') {
			cs.status = 'review'
			cs.ease = Math.max(cfg.minEase, cs.ease + 0.15)
			cs.intervalDays = Math.max(1, Math.round(cfg.graduatingIntervalDays * cfg.easyBonus))
			cs.dueAt = now + cs.intervalDays * DAY_MS
			return recordStudy(state, now)
		}
	}
	// review
	if (rating === 'again') {
		cs.lapses += 1
		cs.status = 'learning'
		cs.stepIndex = 0
		cs.ease = Math.max(cfg.minEase, cs.ease - 0.2)
		cs.intervalDays = Math.max(1, Math.round(cs.intervalDays * 0.7))
		cs.dueAt = now + steps[0] * 60 * 1000
		return recordStudy(state, now)
	}
	if (rating === 'hard') {
		cs.ease = Math.max(cfg.minEase, cs.ease - 0.15)
		cs.intervalDays = Math.max(1, Math.round(cs.intervalDays * 1.2))
		cs.dueAt = now + cs.intervalDays * DAY_MS
		return recordStudy(state, now)
	}
	if (rating === 'good') {
		cs.intervalDays = Math.max(1, Math.round(cs.intervalDays * cs.ease))
		cs.dueAt = now + cs.intervalDays * DAY_MS
		return recordStudy(state, now)
	}
	if (rating === 'easy') {
		cs.ease = Math.max(cfg.minEase, cs.ease + 0.15)
		cs.intervalDays = Math.max(1, Math.round(cs.intervalDays * cs.ease * cfg.easyBonus))
		cs.dueAt = now + cs.intervalDays * DAY_MS
		return recordStudy(state, now)
	}
}

function recordStudy(state: DeckState, now = Date.now()): void {
	const key = todayKey(new Date(now))
	const entry = state.statsByDay[key] ?? { studied: 0 }
	entry.studied += 1
	state.statsByDay[key] = entry
}

