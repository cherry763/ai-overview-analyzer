const express = require('express');
const cors = require('cors');
const path = require('path');
const { getJson } = require('serpapi');

const app = express();
const PORT = 3001;

// ✅ Load SERPAPI_KEY from environment (Render uses this)
const SERPAPI_KEY = process.env.SERPAPI_KEY;

console.log('🔐 SERPAPI_KEY loaded:', SERPAPI_KEY?.slice(0, 6), '...'); // test logging

if (!SERPAPI_KEY) {
  console.error('❌ SERPAPI_KEY missing in environment variables!');
  process.exit(1);
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ✅ Normalize URL for domain-only comparison
const normalizeURL = (url) => {
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
      console.log(`🔎 Analyzing Query: "${query}"`);

      const searchData = await new Promise((resolve, reject) => {
        getJson({
          engine: 'google',
          q: query,
          api_key: SERPAPI_KEY, // ✅ Dynamically passed from env
          hl: 'en',
          gl: 'in',
          num: 10,
          device: 'desktop',
          no_cache: true,
        }, (json) => {
          if (json.error) return reject(new Error(json.error));
          resolve(json);
        });
      });

      // ✅ Extract AI Overview source links (SerpAPI-supported)
      const aiLinks = [];
      if (searchData?.ai_overview?.source_links) {
        aiLinks.push(...searchData.ai_overview.source_links.map(link => ({
          text: link.title || '',
          href: link.link
        })));
      }

      // ✅ Extract top 3 organic links
      const top3Organic = (searchData.organic_results || [])
        .slice(0, 3)
        .map(result => result.link);

      // ✅ Compute similarity between AI Overview links and organic
      const aiDomains = aiLinks.map(link => normalizeURL(link.href));
      const orgDomains = top3Organic.map(link => normalizeURL(link));
      const matches = orgDomains.filter(domain => aiDomains.includes(domain));
      const similarity_score = Math.round((matches.length / 3) * 100);

      // ✅ Package result
      results.push({
        query,
        similarity_score,
        has_ai: !!searchData.ai_overview,
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

// ✅ Serve frontend UI
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

// ✅ Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
