const express = require('express');
const cors = require('cors');
const path = require('path');
const { getJson } = require('serpapi');

const app = express();
const PORT = 3001;

// ✅ Load key from environment
const SERPAPI_KEY = process.env.SERPAPI_KEY;
console.log('🔑 SERPAPI_KEY:', SERPAPI_KEY ? 'Loaded ✅' : 'Missing ❌');

if (!SERPAPI_KEY) {
  console.error('❌ SERPAPI_KEY is NOT set in environment variables. Please set it in Render.');
  process.exit(1); // stop the app
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Helper to normalize domains
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
      console.log(`🔍 Analyzing: "${query}"`);

      const params = {
        engine: 'google',
        q: query,
        api_key: SERPAPI_KEY, // ✅ Important line
        hl: 'en',
        gl: 'in',
        device: 'desktop',
        num: 10,
        no_cache: true,
      };

      const searchData = await new Promise((resolve, reject) => {
        getJson(params, (json) => {
          if (json.error) return reject(new Error(json.error));
          resolve(json);
        });
      });

      // Extract AI Overview links
      const aiLinks = [];
      if (searchData?.ai_overview?.source_links) {
        aiLinks.push(...searchData.ai_overview.source_links.map(link => ({
          text: link.title || '',
          href: link.link
        })));
      }

      // Get top 3 organic results
      const top3Organic = (searchData.organic_results || [])
        .slice(0, 3)
        .map(result => result.link);

      const aiDomains = aiLinks.map(l => normalizeURL(l.href));
      const orgDomains = top3Organic.map(l => normalizeURL(l));

      const matches = orgDomains.filter(domain => aiDomains.includes(domain));
      const similarity_score = Math.round((matches.length / 3) * 100);

      results.push({
        query,
        similarity_score,
        has_ai: !!searchData.ai_overview,
        top_3_organic: top3Organic,
        ai_overview_links: aiLinks
      });

    } catch (error) {
      console.error(`❌ Error processing "${query}":`, error.message);
      results.push({
        query,
        similarity_score: 0,
        has_ai: false,
        top_3_organic: [],
        ai_overview_links: [],
        error: error.message
      });
    }
  }

  res.json(results);
});

// Serve your frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
