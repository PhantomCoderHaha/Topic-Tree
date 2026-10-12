/**
 * Runs async jobs strictly one after another, in call order. The recorder's writes
 * read-modify-write shared state across awaits; two overlapping ones would both build
 * on the same base and one would vanish. A failed job is logged and doesn't block later ones.
 */
export function serial() {
  let chain: Promise<unknown> = Promise.resolve();
  return <T>(job: () => Promise<T>): Promise<T> => {
    const run = chain.then(job);
    chain = run.catch(err => console.error("Topic Tree:", err));
    return run;
  };
}
