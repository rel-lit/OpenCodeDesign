const disposers = new Set<(directory: string) => Promise<void>>()
const beforeDisposers = new Set<(directory: string) => Promise<void>>()

export function registerDisposer(disposer: (directory: string) => Promise<void>) {
  disposers.add(disposer)
  return () => {
    disposers.delete(disposer)
  }
}

export function registerBeforeDisposer(disposer: (directory: string) => Promise<void>) {
  beforeDisposers.add(disposer)
  return () => {
    beforeDisposers.delete(disposer)
  }
}

export async function disposeInstance(directory: string) {
  await Promise.allSettled([...beforeDisposers].map((disposer) => disposer(directory)))
  await Promise.allSettled([...disposers].map((disposer) => disposer(directory)))
}
