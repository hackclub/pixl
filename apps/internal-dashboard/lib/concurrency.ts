// Limit simultaneous outbound requests without introducing a dependency.
// Each completion (including failure) hands its slot to the next queued task.
export function createConcurrencyLimiter(maxConcurrent: number) {
  if (!Number.isSafeInteger(maxConcurrent) || maxConcurrent < 1) {
    throw new RangeError("maxConcurrent must be a positive integer");
  }

  let active = 0;
  const queue: Array<() => void> = [];

  return function limit<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const start = () => {
        active++;
        void Promise.resolve()
          .then(task)
          .then(resolve, reject)
          .finally(() => {
            active--;
            queue.shift()?.();
          });
      };

      if (active < maxConcurrent) start();
      else queue.push(start);
    });
  };
}
