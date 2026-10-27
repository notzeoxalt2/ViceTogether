export async function settleWithin(operation, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation).then(() => true, () => true),
      new Promise(resolve => { timer = setTimeout(() => resolve(false), timeoutMs); })
    ]);
  } finally {
    clearTimeout(timer);
  }
}
