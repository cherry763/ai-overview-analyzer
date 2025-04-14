const express = require('express');
const cors = require('cors');
const path = require('path');
const { getJson } = require('serpapi');

const app = express();
const PORT = 3001; // Default Render port might be 10000, but 3001 is fine if set

// ✅ Load key from environment
const SERPAPI_KEY = process.env.SERPAPI_KEY;
console.log('🔑 SERPAPI_KEY:', SERPAPI_KEY ? 'Loaded ✅' : 'Missing ❌');

if (!SERPAPI_KEY) {
  console.error('❌ SERPAPI_KEY is NOT set in environment variables. Please set it in Render.');
  process.exit(1); // stop the app if key is missing at startup
}

app.use(cors());
app.use(express.json());
// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Helper to normalize domains (remove www. and get hostname)
const normalizeURL = (url) => {
  try {
    if (!url) return ''; // Handle cases where URL might be missing
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '');
  } catch (e) {
    console.warn(`⚠️ Could not parse URL: ${url}`, e.message); // Log URL parsing errors
    // Attempt to extract domain differently if URL object fails
    const domainMatch = url.match(/^(?:https?:\/\/)?(?:www\.)?([^\/]+)/);
     return domainMatch ? domainMatch[1] : url; // Return domain or original string
  }
};

// --- Analysis Endpoint ---
app.post('/analyze', async (req, res) => {
  const queries = req.body.queries || [];
  const results = [];

  console.log(`Processing ${queries.length} queries.`);

  for (const query of queries) {
    try {
      console.log(`🔍 Analyzing: "${query}"`);

      // --- Logging to check the API key value right before use ---
      console.log(`🔑 Checking SERPAPI_KEY before API call. Length: ${SERPAPI_KEY ? SERPAPI_KEY.length : 'undefined/null'}`);
      // Log the key itself - be mindful if logs are public. Brackets help see whitespace.
      console.log(`🔑 Using Key Value: [${SERPAPI_KEY}]`);
      // --- End of Logging ---

      // Extra check just in case, though the startup check should catch missing keys
      if (!SERPAPI_KEY) {
         console.error('❌ SERPAPI_KEY became undefined/empty before API call!');
         throw new Error('Internal Server Error: API Key missing unexpectedly.');
      } // <--- THIS IS THE BRACE THAT WAS MISSING

      // Parameters for the SerpApi request
      const params = {
        engine: 'google',
        q: query,
        api_key: SERPAPI_KEY, // Use the key loaded from environment
        hl: 'en', // Language: English
        gl: 'in', // Geolocation: India (adjust if needed, e.g., 'us')
        device: 'desktop', // Device type
        num: 10, // Number of organic results requested (SerpApi default)
        no_cache: true, // Avoid SerpApi cache for fresh results
      };

      // Call SerpApi using a Promise wrapper for the callback style
      const searchData = await new Promise((resolve, reject) => {
        getJson(params, (json) => {
          // Handle SerpApi specific errors
          if (json.error) {
            console.error(`❌ SerpApi Error for query "${query}":`, json.error);
            // Pass the specific SerpApi error message
            return reject(new Error(`SerpApi Error: ${json.error}`));
          }
          // If no error, resolve the promise with the data
          resolve(json);
        });
      });

      // --- Process the SerpApi response ---

      // Extract AI Overview source links
      const aiLinks = [];
      if (searchData?.ai_overview?.source_links) {
        aiLinks.push(...searchData.ai_overview.source_links
            .filter(link => link && link.link) // Ensure link object and link property exist
            .map(link => ({
                text: link.title || '', // Use title or empty string
                href: link.link
            }))
        );
      }

      // Get top 3 organic results links
      const top3OrganicLinks = (searchData.organic_results || [])
        .slice(0, 3)
        .map(result => result.link)
        .filter(link => !!link); // Ensure links are not null/undefined

      // Normalize domains for comparison
      const aiDomains = aiLinks.map(l => normalizeURL(l.href)).filter(d => !!d); // Filter out empty domains
      const orgDomains = top3OrganicLinks.map(l => normalizeURL(l)).filter(d => !!d); // Filter out empty domains

      // Calculate similarity: percentage of top 3 organic domains found in AI sources
      const matches = orgDomains.filter(orgDomain => aiDomains.includes(orgDomain));
      // Avoid division by zero if there are no top 3 organic results
      const similarity_score = orgDomains.length > 0
            ? Math.round((matches.length / orgDomains.length) * 100)
            : 0; // Calculate based on actual number of top org domains found


      results.push({
        query,
        similarity_score,
        has_ai: !!searchData.ai_overview, // Check if ai_overview object exists
        top_3_organic: top3OrganicLinks, // Return the actual links
        ai_overview_links: aiLinks // Return the extracted AI links
      });

    } catch (error) { // Catch errors from the API call or processing
      console.error(`❌ Error processing "${query}":`, error.message);
      // Log the stack trace for syntax or other unexpected errors during debugging
      // console.error(error.stack);

      results.push({
        query,
        similarity_score: 0,
        has_ai: false,
        top_3_organic: [],
        ai_overview_links: [],
        error: error.message // Include the error message in the result for this query
      });
    }
  } // End of for loop

  console.log(`Finished processing queries. Sending ${results.length} results.`);
  res.json(results); // Send the accumulated results back to the client
});

// --- Serve Frontend ---
// Catch-all route to serve the index.html for any GET request not handled above
// This allows React Router or similar frontend routing to work
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

// --- Start Server ---
// Use Render's PORT environment variable if available, otherwise default
const effectivePort = process.env.PORT || PORT;
app.listen(effectivePort, () => {
  console.log(`🚀 Server running on port ${effectivePort}`);
});
