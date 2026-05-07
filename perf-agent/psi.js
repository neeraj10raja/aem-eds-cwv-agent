const PSI_ENDPOINT = 'https://pagespeedonline.googleapis.com/pagespeedonline/v5/runPagespeed';

function extractOpportunities(audits) {
  return Object.values(audits)
    .filter((a) => a.details?.type === 'opportunity' && (a.numericValue ?? 0) > 0)
    .sort((a, b) => (b.numericValue ?? 0) - (a.numericValue ?? 0))
    .slice(0, 5)
    .map((a) => ({ id: a.id, title: a.title, savings_ms: Math.round(a.numericValue ?? 0) }));
}

function extractMetrics(url, data) {
  const audits = data.lighthouseResult?.audits ?? {};
  const perf = data.lighthouseResult?.categories?.performance;

  return {
    url,
    score: Math.round((perf?.score ?? 0) * 100),
    lcp_ms: Math.round(audits['largest-contentful-paint']?.numericValue ?? 0),
    cls: parseFloat((audits['cumulative-layout-shift']?.numericValue ?? 0).toFixed(3)),
    tbt_ms: Math.round(audits['total-blocking-time']?.numericValue ?? 0),
    fcp_ms: Math.round(audits['first-contentful-paint']?.numericValue ?? 0),
    inp_ms: Math.round(audits['interaction-to-next-paint']?.numericValue ?? 0),
    opportunities: extractOpportunities(audits),
    timestamp: new Date().toISOString(),
  };
}

async function fetchPSI(url, strategy = 'mobile', apiKey = null) {
  const params = new URLSearchParams({ url, strategy: strategy.toUpperCase(), category: 'performance' });
  if (apiKey) params.set('key', apiKey);

  const endpoint = `${PSI_ENDPOINT}?${params}`;

  const run = async () => {
    const res = await fetch(endpoint);
    if (res.status === 429 || res.status === 503) {
      await new Promise((r) => { setTimeout(r, 10_000); });
      const retry = await fetch(endpoint);
      if (!retry.ok) throw new Error(`PSI ${retry.status} for ${url}`);
      return retry.json();
    }
    if (!res.ok) throw new Error(`PSI ${res.status} for ${url}`);
    return res.json();
  };

  return extractMetrics(url, await run());
}

export { fetchPSI };
