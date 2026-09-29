/** Only use for reads or durable commands whose exact envelope can be replayed. */
export async function fetchWithRecovery(url: string, init: RequestInit, isCurrent: () => boolean): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    if (!isCurrent()) throw new Error('Request superseded');
    try {
      const response = await fetch(url, init);
      if (![502, 503, 504].includes(response.status) || attempt === 2) return response;
      await response.body?.cancel();
    } catch (error) {
      if (!(error instanceof TypeError) || attempt === 2) throw error;
    }
    await new Promise(resolve => setTimeout(resolve, attempt === 0 ? 250 : 750));
  }
}
