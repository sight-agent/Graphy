## Deployment

This project is deployed via **GitHub Pages** (GitHub Actions) from the static output in `dist/`.

- Build locally: `npm run build`
- Run tests: `npm test`
- The deployed site is served from a subpath on Pages (`/<repo>/`), so asset/service-worker/manifest URLs are kept relative.

Di seguito una **specifica completa** (webapp) coerente con tutte le scelte che hai fissato, con la semplificazione “lista percorsi + occhio + matita” e con vincoli di integrità (niente delete di elementi usati da percorsi salvati).

---

## 0) Scopo

Webapp che permette di:

* caricare un’immagine e disegnarci sopra un **grafo non orientato** (nodi/archi) con coordinate in pixel dell’immagine originale;
* creare e gestire **percorsi salvati** (lista di nodi) con editing “assistito” (adiacenza o BFS shortest path);
* esportare **PNG overlay** + **JSON** progetto.

---

## 1) Modello dati

### 1.1 Nodo

* `id: string` (unico, immutabile dopo creazione)
* `label: string` (editabile, può ripetersi)
* `x: number`, `y: number` (pixel su immagine originale)

### 1.2 Arco (non orientato)

* rappresentato come coppia `(a,b)` con `a!=b`
* chiave normalizzata per confronti: `key = min(a,b) + "|" + max(a,b)`
* **edge list**: `edges: {a: string, b: string}[]`

### 1.3 Percorso salvato

* `pathId: string` (unico interno)
* `label: string` (editabile)
* `nodeIds: string[]` (lista ordinata di ID nodi, lunghezza ≥ 1)
* `visible: boolean` (occhio)

### 1.4 Stato UI

* `selectedNodeId?: string` (per toggle edge)
* `activePathId?: string` (quello su cui si edita con “matita” attiva; se null → si crea un nuovo percorso con shift+click)
* `activeAppendEnd?: { pathId: string, endIndex: number } | null`

  * rappresenta l’**estremo attivo** del percorso selezionato per append (in pratica: l’indice dell’ultimo nodo su cui “stai continuando”).
  * vincolo: se `activePathId` non è null, deve esistere `activeAppendEnd` scelto dall’utente (vedi §5).

### 1.5 Indici di protezione (integrità)

Derivati dai percorsi salvati (indipendenti da visible):

* `protectedNodeSet: Set<nodeId>` = nodi presenti in almeno un percorso salvato
* `protectedEdgeSet: Set<edgeKey>` = archi che compaiono come coppie consecutive in almeno un percorso salvato

Aggiornati ogni volta che si salva/modifica/cancella un percorso.

---

## 2) Canvas / Viewport

### 2.1 Workspace

* L’immagine caricata definisce dimensioni originali `W x H` (mostrate a UI).
* Tutte le coordinate nodi sono in pixel su `W x H`.

### 2.2 Zoom & Pan

* Rotellina: zoom centrato sul cursore.
* Pan: Space + drag sinistro (o tasto centrale) sposta la viewport.
* Rendering: nodi/archi/percorso si trasformano con lo stesso transform della viewport.

### 2.3 Hit testing

* Nodo: selezionabile se distanza dal centro ≤ `R` (in pixel *schermo*, es. 10–14px).
* Arco: selezionabile se distanza punto-segmento ≤ `T` (in pixel *schermo*, es. 6–8px).
* Priorità in caso di overlap: nodo > arco > sfondo.

---

## 3) Input mouse (senza “modalità”)

### 3.1 Click sinistro (Edit grafo)

**Left click su sfondo**

* crea un nuovo nodo alle coordinate convertite in coordinate immagine (x,y).
* id automatico e unico e “label” automaticamente uguale all'id.
* se un precedente nodo era già selezionato, crei automaticamente anche l'arco che li connette.

**Left click su nodo**

* se nessun nodo selezionato: seleziona quel nodo (`selectedNodeId = id`).
* se nodo selezionato diverso: toggle edge tra `selectedNodeId` e `id`:
  * crea arco se assente
  * mantiene selezione sul primo
* click sul nodo già selezionato: deseleziona.


**Drag sinistro su nodo**

* sposta nodo (aggiorna x,y).

### 3.2 Tasto destro (Delete)

Su canvas: sempre `preventDefault()` per evitare menu browser.

**Right click su nodo**

* se nodo in `protectedNodeSet` → blocca e mostra errore: “Nodo usato nei percorsi salvati: …”
* altrimenti elimina nodo e tutti gli archi incidenti.

**Right click su arco**

* se arco in `protectedEdgeSet` → blocca e mostra errore: “Arco usato nei percorsi salvati: …”
* altrimenti elimina arco.

**Right click su sfondo**

* deseleziona `selectedNodeId`.

---

## 4) Regole di integrità (blocco delete)

È **impossibile** eliminare:

* un nodo che compare in almeno un percorso salvato;
* un arco che compare come coppia consecutiva in almeno un percorso salvato.

Il blocco vale **anche se il percorso è nascosto** (visible=false).

Messaggio errore deve indicare i nomi/label dei percorsi che causano il blocco (se disponibili).

---

## 5) Percorsi: creazione, editing, estremo attivo

### 5.1 Pannello a sinistra “Percorsi”

Lista verticale di percorsi salvati. Ogni riga ha:

* **Occhio**: toggle `visible`
* **Matita**: seleziona quel percorso come `activePathId` (editing target)
* Label percorso + info lunghezza.
* Doppio click su label lo modifica.

### 5.2 Regola generale: cosa succede con Shift+click

Quando fai **Shift + left click** su un nodo:

* Se **matita non attiva** (`activePathId = null`):

  * stai **creando un nuovo percorso** 

* Se **matita attiva** (`activePathId != null`):

  * stai modificando **quel percorso**.
  * vincolo: deve essere definito un **estremo attivo** su cui appendere (vedi §5.4).

### 5.3 Creazione nuovo percorso (matita OFF)

**Shift + left click su nodo**:

* se non esiste un “draft path” corrente:

  * crea nuovo percorso salvato `pathId` con:

    * `nodeIds = [clickedNode]`
    * `label = "Path N"` auto (poi rinominabile)
    * `visible = true`
  * l’**estremo attivo** è l’ultimo nodo aggiunto (indice finale).

Estremo attivo durante creazione:

* sempre l’ultimo nodo di `nodeIds`.

### 5.4 Editing percorso esistente (matita ON)

Quando l’utente preme **matita** su un percorso:

* `activePathId` diventa quel percorso.
* La UI richiede di selezionare un **estremo attivo**:

  * mostra overlay: “Seleziona estremo attivo: clicca un nodo del percorso”.
  * l’utente clicca un nodo che appartiene a `nodeIds` iniziale o finale; questo imposta `activeAppendEnd.endIndex = indexOf(node)`.

Vincolo:

* finché `activePathId != null`, `activeAppendEnd` deve essere non-null prima di poter appendere con shift+click.
* se l’utente cambia percorso con matita, deve riselezionare estremo attivo.

### 5.5 Regole di costruzione/append del percorso (Shift+left click)

Sia in creazione che in editing, si lavora sempre rispetto a:

* `currentPath = (activePathId ? that : newly created path)`
* `endNode = nodeIds[endIndex]` dove `endIndex` è:

  * ultimo indice se stai creando,
  * indice scelto se stai editando.

Quando fai **Shift + left click** su un nodo `target`:

**Caso A — target è già nel percorso**

* comportamento deterministico: **troncatura**

  * trova `k = indexOf(target)` nel percorso.
  * set `nodeIds = nodeIds.slice(0, k+1)`.
  * set estremo attivo a `k` (cioè target diventa l’end).

**Caso B — target è adiacente a endNode**

* adiacente = esiste arco tra `endNode` e `target`.
* allora append semplice:

  * aggiungi `target` in coda rispetto all’estremo attivo.
  * se stai editando da un estremo interno, la parte “dopo” l’estremo attivo viene sostituita (vedi nota sotto).

**Caso C — target non è adiacente a endNode**

* calcola BFS shortest path (min #archi) tra `endNode` e `target`.
* se non esiste:

  * errore “Nessun percorso nel grafo tra …” e non cambia.
* se esiste un cammino `P = [endNode, v2, ..., target]`:

  * appendi `v2..target` al percorso.


### 5.6 Output “stringa percorso” e lunghezza

Per il percorso in editing e per ogni percorso in lista:

* stringa: `id1-id2-id3-...`
* lunghezza:

  * `nodesCount = len(nodeIds)`
  * `edgesCount = nodesCount - 1`

---

## 6) Gestione percorsi (azioni pannello)

### 6.1 Occhio (visibilità)

* `visible=true`: renderizza il percorso sull’immagine.
* `visible=false`: non renderizzare.
* La visibilità non influenza protezioni.

### 6.2 Matita (editing target)

* click matita su un percorso:

  * imposta `activePathId`
  * richiede selezione estremo attivo (§5.4)
* click matita sullo stesso percorso quando già attivo:

  * disattiva editing (`activePathId=null`, `activeAppendEnd=null`)
  * (opzionale) mantiene path evidenziato o no.

### 6.3 Rinominare

* doppio click sul nome del percorso.
* cambia `label`.

### 6.4 Eliminare un percorso

* rimuove il percorso dalla lista.
* aggiorna `protectedNodeSet` e `protectedEdgeSet` di conseguenza.
* se il percorso eliminato era quello attivo in editing: reset `activePathId` e `activeAppendEnd`.

---

## 7) Labels

### 7.1 Label nodi

* Doppio click sul nodo → editor label.
* Mostra label vicino al nodo se diverso da id.
* Hover mostra id.

### 7.2 Label percorsi

* Edit in lista (rename).
* Mostra label vicino alla riga e, opzionalmente, come legenda sull’immagine quando visible.

---

## 8) Rendering

Layer order (dal basso):

1. immagine di background
2. archi del grafo (linee sottili)
3. nodi (cerchi) + label/ID
4. percorsi visibili (linee più evidenti)
5. percorso attivo in editing (highlight distinto)
6. overlay selezione (nodo selezionato, tooltip, ecc.)

---

## 9) Salvataggio / Export

### 9.1 Export JSON (edge list)

Scarica un file `project.json` contenente:

* `imageDataUrl` (o, se preferisci separato, `imageFilename` e esporti anche l’immagine originale)
* `imageWidth`, `imageHeight`
* `nodes: [{id,label,x,y}]`
* `edges: [{a,b}]`
* `paths: [{pathId,label,nodeIds,visible}]`

### 9.2 Export PNG overlay

Scarica un’immagine `overlay.png`:

* background = immagine originale
* overlay = nodi/archi e (a scelta) percorsi visibili
* opzione: includi solo il percorso attivo / includi tutti i visibili.

### 9.3 Undo/Redo

* Undo/redo deve coprire:

  * add node
  * move node (un’azione per drag completo)
  * toggle edge create/remove
  * delete node / delete edge (se non protetti)
  * editing percorso (append/truncate/BFS append)
  * rename label nodo/percorso (opzionale ma consigliato)

Implementazione: stack di “azioni” con `do/undo`.

---

## 10) Errori e messaggi

* Delete protetto: toast/modal con lista percorsi che bloccano.
* BFS non trovato: toast “Nessun cammino”.
* In edit path senza estremo selezionato: overlay “Seleziona estremo attivo”.

---

## 11) Shortcut

* `Ctrl+Z` undo, `Ctrl+Y` redo
* `Esc`:

  * se sta scegliendo estremo attivo → annulla selezione estremo (rimane in edit ma non può appendere finché non seleziona)
  * se in edit path → disattiva matita (opzionale) o solo deseleziona estremo (decidi; raccomandato: deseleziona estremo)
