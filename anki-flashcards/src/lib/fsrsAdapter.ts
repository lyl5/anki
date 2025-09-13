import { fsrs, Rating as FsrsRating, type Card, type FSRSParameters, createEmptyCard } from 'ts-fsrs'

export type FsrsCardState = {
	cid: number
	card: Card
}

export class FsrsScheduler {
	private f = fsrs({})
	private states = new Map<number, FsrsCardState>()

	constructor(params?: Partial<FSRSParameters>) {
		if (params) {
			this.f = fsrs(params)
		}
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

	nextDue(cid: number): Date {
		const c = this.ensureCard(cid)
		return c.due
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

