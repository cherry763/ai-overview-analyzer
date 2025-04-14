const express = require('express');
const cors = require('cors');
const path = require('path');
const { getJson } = require('serpapi');

const app = express();
const PORT = 3001;

// ✅ Securely load SerpAPI key from environment
const SERPAPI_KEY = process.env.SERPAPI_KEY;
console.log('🔐 SERPAPI_KEY loaded:', SERPAPI_KEY?.slice(0, 6), '...');

if (!SERPAPI_KEY) {
  console.error('❌ SERPAPI_KEY is missing in environment variables!');
  process.exit(1);
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 🔁 Normalize domain for similarity comparison
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
      console.log(`🔍 Processing: "${query}"`);

      const serpapiData = await new Promise((resolve, reject) => {
        getJson({
          engine: 'google',
          q: query,
          api_key: SERPAPI_KEY,
          hl: 'en',
          gl: 'in',
          device: 'desktop',
          num: 10,
          no_cache: true
        }, (json) => {
          if (json.error) return reject(new Error(json.error));
          resolve(json);
        });
      });

      const aiLinks = [];

      // Extract AI Overview links (official)
      if (serpapiData?.ai_overview?.source_links) {
        aiLinks.push(...serpapiData.ai_overview.source_links.map(link => ({
          text: link.title || '',
          href: link.link
        })));
      }

      // Extract organic results (top 3)
      const top3Organic = (serpapiData.organic_results || [])
        .slice(0, 3)
        .map(result => result.link);

      // Calculate domain overlap
      const aiDomains = aiLinks.map(link => normalizeURL(link.href));
      const orgDomains = top3Organic.map(link => normalizeURL(link));
      const matches = orgDomains.filter(domain => aiDomains.includes(domain));
      const similarity_score = Math.round((matches.length / 3) * 100);

      results.push({
        query,
        similarity_score,
        has_ai: !!serpapiData.ai_overview,
        top_3_organic: top3Organic,
        ai_overview_links: aiLinks
      });

    } catch (err) {
      console.error(`❌ Error for "${query}":`, err.message);
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

// Serve the frontend (from /public)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
