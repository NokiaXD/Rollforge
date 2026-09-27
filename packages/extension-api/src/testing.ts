export async function runMigration<TIn, TOut>(
  migration: (input: TIn) => TOut | Promise<TOut>,
  input: TIn,
): Promise<TOut> {
  return migration(input);
}