import { useCallback, useMemo, useState, type ChangeEvent } from 'react'
import './App.css'
import { parseApkgFromFile, type ParsedApkg, type ParsedCard } from './lib/apkg'
import { applyAnswer, defaultConfig, getNextDueCardId, loadDeckState, saveDeckState, type DeckState, type Rating } from './lib/scheduler'
import { FsrsScheduler } from './lib/fsrsAdapter'

function CardView({ card }: { card: ParsedCard }) {
  const [flipped, setFlipped] = useState(false)
  return (
    <div style={{ maxWidth: 720, margin: '24px auto', textAlign: 'center' }}>
      <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 24, minHeight: 160 }}>
        <div dangerouslySetInnerHTML={{ __html: flipped ? card.backHtml : card.frontHtml }} />
      </div>
      <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'center' }}>
        <button onClick={() => setFlipped((f) => !f)}>{flipped ? 'Show Front' : 'Show Back'}</button>
      </div>
    </div>
  )
}

function App() {
  const [parsed, setParsed] = useState<ParsedApkg | null>(null)
  const [selectedDeck, setSelectedDeck] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set<string>())
  const [deckState, setDeckState] = useState<DeckState | null>(null)
  const [fsrs, setFsrs] = useState<FsrsScheduler | null>(null)
  const [showAnswer, setShowAnswer] = useState(false)

  const cards = parsed?.cards ?? []
  const decks = parsed?.decks ?? []

  const filtered = useMemo(() => {
    if (!selectedDeck) return cards
    const prefix = selectedDeck + '::'
    return cards.filter(c => c.deckName === selectedDeck || c.deckName.startsWith(prefix))
  }, [cards, selectedDeck])

  // legacy pagination state retained for potential future features; not used in scheduler mode

  const deckCardIds = useMemo(() => new Set(filtered.map(c => c.cardId)), [filtered])

  const currentDueCard = useMemo(() => {
    if (!selectedDeck || !deckState) return null
    const id = getNextDueCardId(selectedDeck, deckState, Array.from(deckCardIds))
    if (id == null) return null
    return filtered.find(c => c.cardId === id) ?? null
  }, [selectedDeck, deckState, filtered, deckCardIds])

  const handleAnswer = useCallback((rating: Rating) => {
    if (!selectedDeck || !deckState) return
    const now = Date.now()
    const ids = Object.keys(deckState.cardStates).map(Number)
    const nextId = getNextDueCardId(selectedDeck, deckState, ids, now)
    if (nextId == null) return
    // Update our legacy scheduler state for daily targets and due filtering
    applyAnswer(deckState, nextId, rating, now, defaultConfig)
    saveDeckState(selectedDeck, deckState)
    setDeckState({ ...deckState, cardStates: { ...deckState.cardStates }, statsByDay: { ...deckState.statsByDay } })
    // If FSRS is present, also update FSRS state for that card
    if (fsrs) {
      fsrs.answer(nextId, rating)
    }
  }, [selectedDeck, deckState, fsrs])

  const rate = useCallback((rating: Rating) => {
    handleAnswer(rating)
    setShowAnswer(false)
  }, [handleAnswer])

  type DeckTreeNode = {
    name: string
    fullName: string
    deckId?: number
    directCount: number
    totalCount: number
    children: DeckTreeNode[]
  }

  const deckTree = useMemo<DeckTreeNode>(() => {
    const root: DeckTreeNode = { name: '', fullName: '', directCount: 0, totalCount: 0, children: [] }
    if (!decks.length) return root

    const directCountByDeckName = new Map<string, number>()
    decks.forEach(d => { directCountByDeckName.set(d.name, 0) })
    for (const card of cards) {
      directCountByDeckName.set(card.deckName, (directCountByDeckName.get(card.deckName) ?? 0) + 1)
    }

    const getOrAddChild = (parent: DeckTreeNode, segment: string, fullName: string): DeckTreeNode => {
      const found = parent.children.find(c => c.name === segment)
      if (found) return found
      const node: DeckTreeNode = {
        name: segment,
        fullName,
        deckId: decks.find(d => d.name === fullName)?.deckId,
        directCount: 0,
        totalCount: 0,
        children: []
      }
      parent.children.push(node)
      return node
    }

    // Build nodes from deck names
    for (const d of decks) {
      const parts = d.name.split('::')
      let cursor = root
      let path = ''
      for (let i = 0; i < parts.length; i++) {
        path = i === 0 ? parts[i] : path + '::' + parts[i]
        cursor = getOrAddChild(cursor, parts[i], path)
      }
    }

    // Assign direct counts
    const assignDirectCounts = (node: DeckTreeNode) => {
      if (node.fullName) {
        node.directCount = directCountByDeckName.get(node.fullName) ?? 0
      }
      node.children.forEach(assignDirectCounts)
    }
    assignDirectCounts(root)

    // Compute totals bottom-up
    const computeTotals = (node: DeckTreeNode): number => {
      let total = node.directCount
      for (const child of node.children) total += computeTotals(child)
      node.totalCount = total
      return total
    }
    computeTotals(root)

    // Sort children alphabetically for stable UI
    const sortTree = (node: DeckTreeNode) => {
      node.children.sort((a, b) => a.name.localeCompare(b.name))
      node.children.forEach(sortTree)
    }
    sortTree(root)

    return root
  }, [decks, cards])

  const toggleExpanded = useCallback((key: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const onFile = useCallback(async (file: File) => {
    try {
      if (parsed) {
        parsed.cleanup()
        setParsed(null)
        setSelectedDeck(null)
        setExpanded(new Set<string>())
      }
      const result = await parseApkgFromFile(file)
      setParsed(result)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to import package.'
      alert(message + '\nIf the deck was exported with a much newer Anki version, please re-export as .apkg/.colpkg (legacy support enabled) and try again.')
    }
  }, [parsed])

  const onInputChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) onFile(f)
  }, [onFile])

  return (
    <div style={{ padding: 24 }}>
      <h1>APKG Flashcards</h1>
      <input type="file" accept=".apkg,.colpkg" onChange={onInputChange} />
      {!parsed ? (
        <p style={{ marginTop: 16 }}>Load an .apkg/.colpkg file to begin.</p>
      ) : !selectedDeck ? (
        <div style={{ marginTop: 16, maxWidth: 720, marginInline: 'auto' }}>
          <h2>Select a deck</h2>
          <DeckTree
            node={deckTree}
            expanded={expanded}
            onToggle={toggleExpanded}
            onSelect={(fullName) => {
              setSelectedDeck(fullName)
              const ids = filtered.filter(c => c.deckName === fullName || c.deckName.startsWith(fullName + '::')).map(c => c.cardId)
              const st = loadDeckState(fullName, ids)
              setDeckState(st)
              setFsrs(new FsrsScheduler())
              setShowAnswer(false)
            }}
          />
        </div>
      ) : currentDueCard ? (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', maxWidth: 720, margin: '16px auto', gap: 12 }}>
            <button onClick={() => { setSelectedDeck(null) }}>Back to decks</button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <label>Daily target:</label>
              <input
                type="number"
                min={1}
                value={deckState?.dailyTarget ?? 20}
                onChange={(e) => {
                  if (!deckState || !selectedDeck) return
                  const v = Math.max(1, Number(e.target.value) || 1)
                  const next = { ...deckState, dailyTarget: v }
                  setDeckState(next)
                  saveDeckState(selectedDeck, next)
                }}
                style={{ width: 80 }}
              />
            </div>
          </div>
          <CardView key={currentDueCard.cardId} card={currentDueCard} />
          {!showAnswer ? (
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 12 }}>
              <button onClick={() => setShowAnswer(true)}>Show Answer</button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 12 }}>
              <button onClick={() => rate('again')}>Again</button>
              <button onClick={() => rate('hard')}>Hard</button>
              <button onClick={() => rate('good')}>Good</button>
              <button onClick={() => rate('easy')}>Easy</button>
            </div>
          )}
        </>
      ) : (
        <p style={{ marginTop: 16 }}>All done for today in this deck.</p>
      )}
    </div>
  )
}

function DeckTree({ node, expanded, onToggle, onSelect }: {
  node: { name: string, fullName: string, totalCount: number, children: any[] }
  expanded: Set<string>
  onToggle: (key: string) => void
  onSelect: (fullName: string) => void
}) {
  const renderNode = (n: any, depth: number) => {
    if (!n.fullName && n.children) {
      // root
      return (
        <ul style={{ listStyle: 'none', paddingLeft: 0 }}>
          {n.children.map((c: any) => renderNode(c, 0))}
        </ul>
      )
    }
    const hasChildren = n.children && n.children.length > 0
    const isOpen = expanded.has(n.fullName)
    return (
      <li key={n.fullName}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {hasChildren ? (
            <button onClick={() => onToggle(n.fullName)} aria-label={isOpen ? 'Collapse' : 'Expand'}>
              {isOpen ? '▾' : '▸'}
            </button>
          ) : (
            <span style={{ width: '1.5em', display: 'inline-block' }} />
          )}
          <button onClick={() => onSelect(n.fullName)} style={{ flex: 1, display: 'flex', justifyContent: 'space-between' }}>
            <span>{n.name}</span>
            <span>{n.totalCount}</span>
          </button>
        </div>
        {hasChildren && isOpen && (
          <ul style={{ listStyle: 'none', paddingLeft: 24 }}>
            {n.children.map((c: any) => renderNode(c, depth + 1))}
          </ul>
        )}
      </li>
    )
  }
  return (
    <div>
      {renderNode(node, 0)}
    </div>
  )
}


//


export default App
