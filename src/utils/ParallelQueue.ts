export class ParallelQueue {
  #queue: Array<() => void> = [];
  activeTasks = 0;
  maxTasks: number;

  constructor(maxTasks: number) {
    this.maxTasks = maxTasks;
  }

  runTask<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (this.activeTasks < this.maxTasks) {
        this.activeTasks++;

        task()
          .finally(() => {
            if (this.#queue.length > 0) {
              this.#queue.shift()!();
            } else {
              this.activeTasks--;
            }
          })
          .then(resolve, reject);
      } else {
        this.#queue.push(() => {
          task()
            .finally(() => {
              if (this.#queue.length > 0) {
                this.#queue.shift()!();
              } else {
                this.activeTasks--;
              }
            })
            .then(resolve, reject);
        });
      }
    });
  }
}
