//  in-process mutex keyed by documentType. Hoy solo lo usa la
// migración eager del manager (un único proceso → no es estrictamente
// necesario, pero uniformiza con el camino lazy que usará Paso 18 para
// compendios). Si dos readers llamaran runExclusive("Actor") al mismo
// tiempo, el segundo espera al primero. Diferentes tipos corren en paralelo.
export class MigrationLock {
  private chains = new Map<string, Promise<void>>();

  async runExclusive(type: string, fn: () => Promise<void>): Promise<void> {
    const previous = this.chains.get(type) ?? Promise.resolve();
    let release: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    // Save the composed promise in a variable so the cleanup check below
    // compares against the exact same object reference we stored. Calling
    // `previous.then(() => next)` twice would create two distinct Promise
    // instances, making the `===` check always false and leaking the entry.
    const chain = previous.then(() => next);
    this.chains.set(type, chain);
    await previous;
    try {
      await fn();
    } finally {
      release!();
      // Limpieza: si nadie más tomó la cadena después de este run, soltamos
      // el slot para no acumular closures. La comparación es contra la
      // promesa exacta que escribimos; si cambió, otro caller ya tomó el
      // relevo y mantiene su propia entrada.
      if (this.chains.get(type) === chain) {
        this.chains.delete(type);
      }
    }
  }
}