import { useCallback, useState, type ChangeEvent } from 'react'
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

  const cards = parsed?.cards ?? []
  const current = cards[index]

  const onFile = useCallback(async (file: File) => {
    if (parsed) {
      parsed.cleanup()
      setParsed(null)
      setIndex(0)
    }
    const result = await parseApkgFromFile(file)
    setParsed(result)
    setIndex(0)
  }, [parsed])

  const onInputChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) onFile(f)
  }, [onFile])

  return (
    <div style={{ padding: 24 }}>
      <h1>APKG Flashcards</h1>
      <input type="file" accept=".apkg" onChange={onInputChange} />
      {current ? (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', maxWidth: 720, margin: '16px auto' }}>
            <button onClick={() => setIndex((i) => Math.max(0, i - 1))} disabled={index === 0}>Prev</button>
            <div>{index + 1} / {cards.length}</div>
            <button onClick={() => setIndex((i) => Math.min(cards.length - 1, i + 1))} disabled={index >= cards.length - 1}>Next</button>
          </div>
          <CardView card={current} />
        </>
      ) : (
        <p style={{ marginTop: 16 }}>Load an .apkg file to begin.</p>
      )}
    </div>
  )
}

export default App
