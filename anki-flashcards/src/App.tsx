import { useCallback, useMemo, useState, type ChangeEvent } from 'react'
import './App.css'
import { parseApkgFromFile, type ParsedApkg, type ParsedCard } from './lib/apkg'

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
  const [index, setIndex] = useState(0)
  const [selectedDeck, setSelectedDeck] = useState<string | null>(null)

  const cards = parsed?.cards ?? []
  const decks = parsed?.decks ?? []

  const filtered = useMemo(() => {
    if (!selectedDeck) return cards
    const prefix = selectedDeck + '::'
    return cards.filter(c => c.deckName === selectedDeck || c.deckName.startsWith(prefix))
  }, [cards, selectedDeck])

  const current = filtered[index]

  const onFile = useCallback(async (file: File) => {
    try {
      if (parsed) {
        parsed.cleanup()
        setParsed(null)
        setIndex(0)
        setSelectedDeck(null)
      }
      const result = await parseApkgFromFile(file)
      setParsed(result)
      setIndex(0)
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
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
            {decks
              .slice()
              .sort((a, b) => a.name.localeCompare(b.name))
              .map(d => {
                const prefix = d.name + '::'
                const count = cards.filter(c => c.deckName === d.name || c.deckName.startsWith(prefix)).length
                return (
                  <li key={d.deckId}>
                    <button onClick={() => { setSelectedDeck(d.name); setIndex(0) }} style={{ width: '100%', display: 'flex', justifyContent: 'space-between' }}>
                      <span>{d.name}</span>
                      <span>{count}</span>
                    </button>
                  </li>
                )
              })}
          </ul>
        </div>
      ) : current ? (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', maxWidth: 720, margin: '16px auto' }}>
            <button onClick={() => { setSelectedDeck(null); setIndex(0) }}>Back to decks</button>
            <button onClick={() => setIndex((i) => Math.max(0, i - 1))} disabled={index === 0}>Prev</button>
            <div>{index + 1} / {filtered.length}</div>
            <button onClick={() => setIndex((i) => Math.min(filtered.length - 1, i + 1))} disabled={index >= filtered.length - 1}>Next</button>
          </div>
          <CardView card={current} />
        </>
      ) : (
        <p style={{ marginTop: 16 }}>No cards in this deck.</p>
      )}
    </div>
  )
}

export default App
