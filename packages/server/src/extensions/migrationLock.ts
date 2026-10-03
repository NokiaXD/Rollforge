//  in-process mutex keyed by DOCUMENT ID, not by documentType. §12 fija
// "lock efímero en memoria por id de documento": la unidad que se
// serializa es el documento, porque dos readers del mismo documento deben
// compartir el resultado de una sola migración. Keying by documentType
// (lo que hizo el Paso 15) era más ancho que el spec y tenía un coste
// real: abrir diez entradas de un pack las serializaba entre sí aunque
// fuesen documentos distintos. Documentos distintos corren en paralelo.
// La distinción importa también para el caso "más nuevo que lo que el
// core conoce" (§12): bloquear todo el tipo por un documento incompatible
// dejaría sin poder editar al resto.
export class MigrationLock {
  private chains = new Map<string, Promise<void>>();

  async runExclusive(docId: string, fn: () => Promise<void>): Promise<void> {
    const previous = this.chains.get(docId) ?? Promise.resolve();
    let release: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    // Save the composed promise in a variable so the cleanup check below
    // compares against the exact same object reference we stored. Calling
    // `previous.then(() => next)` twice would create two distinct Promise
    // instances, making the `===` check always false and leaking the entry.
    const chain = previous.then(() => next);
    this.chains.set(docId, chain);
    await previous;
    try {
      await fn();
    } finally {
      release!();
      // Limpieza: si nadie más tomó la cadena después de este run, soltamos
      // el slot para no acumular closures. La comparación es contra la
      // promesa exacta que escribimos; si cambió, otro caller ya tomó el
      // relevo y mantiene su propia entrada.
      if (this.chains.get(docId) === chain) {
        this.chains.delete(docId);
      }
    }
  }
}