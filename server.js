const express = require('express');
const cors = require('cors');
const path = require('path');
const { getJson } = require('serpapi');

const app = express();
const PORT = 3001;

// ✅ Pull the SerpAPI key from your Render Environment Variables
const SERPAPI_KEY = process.env.SERPAPI_KEY;

if (!SERPAPI_KEY) {
  console.error('❌ SERPAPI_KEY is not defined in environment variables');
  process.exit(1); // Stop server if key is missing
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Normalize URL to domain for scoring
const normalizeURL = url => {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

app.post('/analyze', async (req, res) => {
  const queries = req.body.queries || [];
  const results = [];

  for (const query of queries) {
    try {
      console.log(`🔍 Analyzing query: "${query}"`);

      // Build SerpAPI search parameters
      const params = {
        engine: 'google',
        q: query,
        api_key: 55de22305f6255c1be524fa3d052caa40724000e7233fe825f8942090a4a3cff,
        hl: 'en',
        gl: 'in',
        num: 10,
        device: 'desktop',
        no_cache: true
      };

      // Wrap getJson in a Promise to use with async/await
      const data = await new Promise((resolve, reject) => {
        getJson(params, json => {
          if (json.error) {
            reject(new Error(json.error));
          } else {
            resolve(json);
          }
        });
      });

      // Extract AI Overview source links
      const aiLinks = [];
      if (data?.ai_overview?.source_links) {
        aiLinks.push(
          ...data.ai_overview.source_links.map(link => ({
            text: link.title || '',
            href: link.link
          }))
        );
      }

      // Extract top 3 organic search links
      const top3Organic = (data.organic_results || [])
        .slice(0, 3)
        .map(result => result.link);

      // Normalize and calculate similarity score
      const aiDomains = aiLinks.map(link => normalizeURL(link.href));
      const orgDomains = top3Organic.map(link => normalizeURL(link));

      const matches = orgDomains.filter(domain => aiDomains.includes(domain));
      const similarity_score = Math.round((matches.length / 3) * 100);

      results.push({
        query,
        similarity_score,
        has_ai: !!data.ai_overview,
        top_3_organic: top3Organic,
        ai_overview_links: aiLinks
      });

    } catch (err) {
      console.error(`❌ Failed to process "${query}":`, err.message);
      results.push({
        query,
        similarity_score: 0,
        has_ai: false,
        top_3_organic: [],
        ai_overview_links: [],
        error: err.message
      });
    }
  }

  res.json(results);
});

// Serve frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
