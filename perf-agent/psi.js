const PSI_ENDPOINT = 'https://pagespeedonline.googleapis.com/pagespeedonline/v5/runPagespeed';
const RETRY_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

function wait(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

function getPSIStatus(error) {
  const status = Number(error.message.match(/PSI (\d+)/)?.[1]);
  return Number.isNaN(status) ? null : status;
}

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

  const run = async (retries = 3) => {
    let lastError;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const res = await fetch(endpoint);
        if (res.ok) return res.json();

        lastError = new Error(`PSI ${res.status} for ${url}`);
        if (!RETRY_STATUSES.has(res.status) || attempt === retries) {
          throw lastError;
        }
      } catch (err) {
        lastError = err;
        if (attempt === retries) throw lastError;
      }

      const status = getPSIStatus(lastError);
      if (status && !RETRY_STATUSES.has(status)) {
        throw lastError;
      }

      // eslint-disable-next-line no-await-in-loop
      await wait(5000 * 2 ** attempt);
    }

    throw lastError;
  };

  return extractMetrics(url, await run());
}

export { extractMetrics, fetchPSI };
