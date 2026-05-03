// Polyfills required for older Node.js runtimes used during static export builds.
// Next.js may generate code that relies on Promise.withResolvers, which is not
// available in all Node 20.x versions.

if (typeof Promise.withResolvers !== 'function') {
  Object.defineProperty(Promise, 'withResolvers', {
    value: function withResolvers<T = unknown>() {
      let resolve: (value: T | PromiseLike<T>) => void;
      let reject: (reason?: any) => void;

      const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
      });

      return {
        promise,
        resolve: resolve!,
        reject: reject!,
      };
    },
    configurable: true,
    writable: true,
  });
}
