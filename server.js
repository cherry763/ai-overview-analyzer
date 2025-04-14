const express = require('express');
const cors = require('cors');
const path = require('path');
const { getJson } = require('serpapi'); // Ensure you have 'serpapi' installed: npm install serpapi

const app = express();
const PORT = 3001;

// --- --- --- --- --- --- --- --- --- --- --- --- --- --- --- ---
// 🔐 IMPORTANT: Replace with your actual SerpAPI key
// It's highly recommended to use environment variables for API keys
// Example: const SERPAPI_KEY = process.env.SERPAPI_KEY;
const SERPAPI_KEY = process.env.55de22305f6255c1be524fa3d052caa40724000e7233fe825f8942090a4a3cff;// --- --- --- --- --- --- --- --- --- --- --- --- --- --- --- ---

if (SERPAPI_KEY === '55de22305f6255c1be524fa3d052caa40724000e7233fe825f8942090a4a3cff') {
  console.warn("⚠️ WARNING: Using placeholder SerpAPI Key. Please replace 'YOUR_SERPAPI_API_KEY' with your actual key.");
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'))); // Assuming you have a 'public' folder for frontend

// 👉 Helper to normalize domains for fuzzy comparison
const normalizeURL = url => {
  if (!url) return ''; // Handle cases where URL might be null or undefined
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '');
  } catch (e) {
    // Handle invalid URLs gracefully
    console.warn(`Could not parse URL: ${url}`);
    return url; // Return original string if parsing fails
  }
};

// Promisify the SerpApi getJson function for easier async/await usage
const getJsonAsync = (params) => {
  return new Promise((resolve, reject) => {
    getJson(params, (result) => {
      // Check for errors returned within the SerpApi result object
      if (result.error) {
        reject(new Error(`SerpApi Error: ${result.error}`));
      } else if (result.search_metadata?.status === 'Error') {
        // Sometimes errors are indicated by status
         reject(new Error(`SerpApi Search Error: ${result.search_metadata?.error || 'Unknown error'}`));
      } else {
        resolve(result);
      }
    });
  });
};


app.post('/analyze', async (req, res) => {
  const queries = req.body.queries || [];
  if (!Array.isArray(queries) || queries.length === 0) {
    return res.status(400).json({ error: 'Please provide an array of queries.' });
  }

  const results = [];

  for (const query of queries) {
    let queryResult = {
        query,
        similarity_score: 0,
        has_ai: false,
        top_3_organic: [],
        ai_overview_links: [],
        error: null,
        ai_status: 'Not Present' // Statuses: Not Present, Embedded, Asynchronous, Error Fetching Async, Async No Links, Error Reported by Google, Present No Links/Token, Processing Error
    };

    try {
      console.log(`\n🔍 Query: "${query}"`);

      // --- Step 1: Initial Google Search Request ---
      const initialParams = {
        engine: 'google',
        q: query,
        api_key: SERPAPI_KEY,
        hl: 'en',       // Language: English
        gl: 'us',       // Country: United States (often has AI Overviews first)
        num: 10,        // Number of results
        device: 'desktop',
        no_cache: true // Force fresh results for testing/analysis
      };

      console.log(`  [1] Making initial search request...`);
      const initialData = await getJsonAsync(initialParams);
      console.log(`  [1] Initial search successful.`);

      // --- Step 2: Extract Top 3 Organic Results ---
      queryResult.top_3_organic = (initialData.organic_results || [])
        .slice(0, 3)
        .map(result => result.link)
        .filter(link => !!link); // Ensure links are not null/undefined

      // --- Step 3: Check for AI Overview ---
      const aiOverviewData = initialData.ai_overview;
      let aiLinks = [];

      if (aiOverviewData) {
          // Case A: AI Overview content is directly embedded
          // *** MODIFIED: Check for 'references' instead of 'source_links' ***
          if (aiOverviewData.references && Array.isArray(aiOverviewData.references)) {
              console.log("  [2] AI Overview found: Embedded (using 'references')");
              queryResult.has_ai = true;
              queryResult.ai_status = 'Embedded';
              // *** MODIFIED: Map over 'references' using ref.title and ref.link ***
              aiLinks = aiOverviewData.references.map(ref => ({
                text: ref.title || '',
                href: ref.link
              })).filter(link => !!link.href); // Ensure href exists
          }
          // Case B: AI Overview needs an asynchronous fetch (page_token present)
          else if (aiOverviewData.page_token) {
              console.log("  [2] AI Overview needs asynchronous fetch (page_token found).");
              queryResult.ai_status = 'Asynchronous'; // Mark as async even if fetch fails
              const aiParams = {
                  engine: 'google_ai_overview',
                  page_token: aiOverviewData.page_token,
                  api_key: SERPAPI_KEY,
                  async: false,
                  no_cache: true
              };

              try {
                  console.log(`  [3] Making asynchronous AI Overview request...`);
                  const asyncAiData = await getJsonAsync(aiParams);
                  console.log(`  [3] Asynchronous AI Overview request successful.`);

                   // *** MODIFIED: Check asyncAiData.ai_overview.references ***
                  if (asyncAiData?.ai_overview?.references && Array.isArray(asyncAiData.ai_overview.references)) {
                     queryResult.has_ai = true; // Only set true if successfully fetched
                     // *** MODIFIED: Map over async 'references' using ref.title and ref.link ***
                     aiLinks = asyncAiData.ai_overview.references.map(ref => ({
                        text: ref.title || '',
                        href: ref.link
                      })).filter(link => !!link.href);
                  } else if (asyncAiData?.error) {
                     console.error(`  [3] Error fetching async AI Overview for "${query}": ${asyncAiData.error}`);
                     queryResult.ai_status = 'Error Fetching Async';
                  } else {
                     console.log(`  [3] Asynchronous AI Overview request succeeded but contained no source links in 'references'.`);
                     queryResult.ai_status = 'Async No Links';
                  }
              } catch (asyncError) {
                  console.error(`  [3] FAILED fetching async AI Overview for "${query}":`, asyncError.message);
                  queryResult.ai_status = 'Error Fetching Async';
              }
          }
           // Case C: AI Overview block exists but contains an error message
          else if (aiOverviewData.error) {
            console.log(`  [2] AI Overview found but contains an error: ${aiOverviewData.error}`);
            queryResult.ai_status = 'Error Reported by Google';
          }
          // Case D: AI Overview block exists but has no references or page_token
          else {
            // *** MODIFIED: Updated log message ***
            console.log("  [2] AI Overview block detected, but no 'references' or page token found.");
             queryResult.ai_status = 'Present No Links/Token';
          }
      } else {
        console.log("  [2] AI Overview not present in initial results.");
        queryResult.ai_status = 'Not Present';
      }

      queryResult.ai_overview_links = aiLinks;

      // --- Step 4: Calculate Similarity Score ---
      if (queryResult.top_3_organic.length > 0 && aiLinks.length > 0) {
        const aiDomains = aiLinks.map(link => normalizeURL(link.href)).filter(d => d); // Filter empty domains
        const orgDomains = queryResult.top_3_organic.map(link => normalizeURL(link)).filter(d => d);

        const matched = orgDomains.filter(domain => aiDomains.includes(domain)).length;

        // Ensure division by zero doesn't happen if top_3_organic is empty after normalization
        const denominator = Math.min(3, orgDomains.length); // Compare against actual number of valid organic domains (up to 3)
        if (denominator > 0) {
             queryResult.similarity_score = Math.round((matched / denominator) * 100);
        }
         console.log(`  [4] Similarity Calculation: Matched ${matched} of ${denominator} domains -> ${queryResult.similarity_score}%`);
      } else {
         console.log(`  [4] Similarity Calculation: Skipped (No organic or AI links).`);
      }

    } catch (error) {
      // Catch errors from the initial API call or other processing steps
      console.error(`❌ Overall Error processing "${query}":`, error.message);
      queryResult.error = error.message;
      queryResult.ai_status = 'Processing Error'; // Indicate a general failure
      // Ensure default values are kept if error occurred early
      queryResult.similarity_score = 0;
      queryResult.has_ai = false;
      queryResult.top_3_organic = queryResult.top_3_organic || [];
      queryResult.ai_overview_links = queryResult.ai_overview_links || [];
    } finally {
      // Add the result (or error state) to the final list
      results.push(queryResult);
    }
  } // End of query loop

  res.json(results);
});

// Serve the frontend entry point for any other GET request
app.get('*', (req, res) => {
  const indexPath = path.join(__dirname, 'public', 'index.html');
  res.sendFile(indexPath, (err) => {
    if (err) {
        console.error("Error sending index.html:", err);
        // Avoid sending file if headers already sent or other issues
        if (!res.headersSent) {
             res.status(err.status || 500).send("Could not load the application page.");
        }
    }
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log("Ensure you have a 'public' directory with an 'index.html' file.");
  console.log("API endpoint available at POST /analyze");
});
