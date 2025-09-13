import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import JSZip from 'jszip';

export type ParsedCard = {
	cardId: number;
	noteId: number;
	deckId: number;
	deckName: string;
	frontHtml: string;
	backHtml: string;
	mediaMap: Record<string, string>; // filename -> object URL
};

export type ParsedDeck = {
	name: string;
	deckId: number;
};

export type ParsedApkg = {
	cards: ParsedCard[];
	decks: ParsedDeck[];
	cleanup: () => void; // revokeObjectURLs
};

async function loadSqlWasm(): Promise<SqlJsStatic> {
	// Use Vite's ?url to get a resolved asset URL for the wasm file
	const SQL = await initSqlJs({ locateFile: () => sqlWasmUrl });
	return SQL;
}

function renderFieldsToFrontBack(fields: string[], modelCss?: string): { frontHtml: string; backHtml: string } {
	// Basic rendering: assume field[0] = Front, field[1] = Back
	const front = fields[0] ?? '';
	const back = fields[1] ?? '';
	const styleTag = modelCss ? `<style>${modelCss}</style>` : '';
	return {
		frontHtml: `${styleTag}<div class="card front">${front}</div>`,
		backHtml: `${styleTag}<div class="card back">${back}</div>`,
	};
}

function rewriteMediaSrc(html: string, mediaMap: Record<string, string>): string {
    // Replace src="filename" or src='filename' with object URLs when present in mediaMap
    return html.replace(/src=("|')([^"']+)(\1)/g, (match, quote, path) => {
        const mapped = mediaMap[path];
        if (mapped) {
            return `src=${quote}${mapped}${quote}`;
        }
        return match;
    });
}

export async function parseApkgFromFile(file: File): Promise<ParsedApkg> {
	const zip = await JSZip.loadAsync(file);

	// Discover sqlite file name across modern/legacy formats
	// Support: collection.anki21b, collection.anki21, collection.anki2, collection.sqlite
	const dbCandidates = zip.file(/(^|\/)collection\.(?:anki21b|anki21|anki2|sqlite)$/);
	const dbEntry = dbCandidates[0];
	if (!dbEntry) {
		throw new Error('Unsupported or unknown package format. Please re-export from the latest Anki as .apkg/.colpkg.');
	}

	const dbUint8 = new Uint8Array(await dbEntry.async('arraybuffer'));
	const SQL = await loadSqlWasm();
	const db: Database = new SQL.Database(dbUint8);

	// Parse media map file if present (Anki places a JSON file named media)
	let filenameById: Record<string, string> = {};
	const mediaFile = zip.file('media');
	if (mediaFile) {
		try {
			filenameById = JSON.parse(await mediaFile.async('string')) as Record<string, string>;
		} catch {
			filenameById = {};
		}
	}

	// Load notes
	// notes.sfld = first field; notes.flds = all fields separated by 0x1f (\u001f)
	// models are in col.models as JSON, but a quick approach is to ignore templates and take first two fields
	const notesStmt = db.prepare('SELECT id, flds FROM notes');
	const noteIdToFields: Map<number, string[]> = new Map();
	while (notesStmt.step()) {
		const row = notesStmt.getAsObject() as { id: number; flds: string };
		noteIdToFields.set(row.id, (row.flds || '').split('\u001f'));
	}
	notesStmt.free();

	// Load decks
	// Decks are stored as JSON in col.decks. Pull minimal mapping id->name.
	const decks: ParsedDeck[] = [];
	const deckIdToName: Map<number, string> = new Map();
	try {
		const colStmt = db.prepare('SELECT decks FROM col');
		if (colStmt.step()) {
			const row = colStmt.getAsObject() as { decks: string };
			const decksJson = JSON.parse(row.decks) as Record<string, { name: string }>;
			Object.entries(decksJson).forEach(([idStr, deckObj]) => {
				const deckId = Number(idStr);
				deckIdToName.set(deckId, deckObj.name);
				decks.push({ deckId, name: deckObj.name });
			});
		}
		colStmt.free();
	} catch {
		// ignore deck parsing errors
	}

	// Load cards and join to notes
	const cards: ParsedCard[] = [];
	const cardStmt = db.prepare('SELECT id, nid, did FROM cards');
	while (cardStmt.step()) {
		const row = cardStmt.getAsObject() as { id: number; nid: number; did: number };
		const fields = noteIdToFields.get(row.nid) || [];
		const { frontHtml, backHtml } = renderFieldsToFrontBack(fields);
		cards.push({
			cardId: row.id,
			noteId: row.nid,
			deckId: row.did,
			deckName: deckIdToName.get(row.did) ?? String(row.did),
			frontHtml,
			backHtml,
			mediaMap: {},
		});
	}
	cardStmt.free();

	// Build media object URLs
	const objectUrlsToRevoke: string[] = [];
	const filenameToUrl: Record<string, string> = {};
	await Promise.all(
		Object.entries(filenameById).map(async ([idStr, filename]) => {
			const entry = zip.file(idStr);
			if (!entry) return;
			const blob = await entry.async('blob');
			const url = URL.createObjectURL(blob);
			filenameToUrl[filename] = url;
			objectUrlsToRevoke.push(url);
		})
	);

	// Attach media maps and pre-rewrite HTML src attributes to object URLs
	cards.forEach((c) => {
		c.mediaMap = filenameToUrl;
		c.frontHtml = rewriteMediaSrc(c.frontHtml, filenameToUrl);
		c.backHtml = rewriteMediaSrc(c.backHtml, filenameToUrl);
	});

	return {
		cards,
		decks,
		cleanup: () => {
			objectUrlsToRevoke.forEach((u) => URL.revokeObjectURL(u));
			db.close();
		},
	};
}

