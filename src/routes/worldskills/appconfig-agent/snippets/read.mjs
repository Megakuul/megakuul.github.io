export async function getConfig() {
  const url = 'http://127.0.0.1:2772' + process.env.APPCONFIG_PATH;
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error(`AppConfig HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      if (attempt === 4) throw error;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
}
