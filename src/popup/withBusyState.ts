export async function withBusyState<T>(setBusy: (busy: boolean) => void, task: () => Promise<T>): Promise<T> {
  setBusy(true);
  try {
    return await task();
  } finally {
    setBusy(false);
  }
}
