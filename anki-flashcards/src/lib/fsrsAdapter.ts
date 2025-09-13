import { fsrs, Rating as FsrsRating, State as FsrsState, type Card, type FSRSParameters, createEmptyCard } from 'ts-fsrs'

export type FsrsCardState = {
	cid: number
	card: Card
}

export class FsrsScheduler {
	private f = fsrs({})
	private states = new Map<number, FsrsCardState>()

	constructor(params?: Partial<FSRSParameters>) {
		const base = params ?? { enable_short_term: true }
		this.f = fsrs(base)
	}

	ensureCard(cid: number): Card {
		let st = this.states.get(cid)
		if (!st) {
			const created = createEmptyCard(new Date())
			st = { cid, card: created }
			this.states.set(cid, st)
		}
		return st.card
	}

	has(cid: number): boolean {
		return this.states.has(cid)
	}

	nextDue(cid: number): Date | null {
		const st = this.states.get(cid)
		return st ? st.card.due : null
	}

	getPhase(cid: number): 'new' | 'learning' | 'review' | null {
		const st = this.states.get(cid)
		if (!st) return null
		switch (st.card.state) {
			case FsrsState.New: return 'new'
			case FsrsState.Learning:
			case FsrsState.Relearning: return 'learning'
			case FsrsState.Review: return 'review'
			default: return null
		}
	}

	answer(cid: number, rating: 'again' | 'hard' | 'good' | 'easy', now = new Date()): void {
		const c = this.ensureCard(cid)
		const grade =
			rating === 'again'
				? FsrsRating.Again
			: rating === 'hard'
				? FsrsRating.Hard
			: rating === 'good'
				? FsrsRating.Good
			: FsrsRating.Easy
		const { card } = this.f.next(c, now, grade)
		this.states.set(cid, { cid, card })
	}
}

