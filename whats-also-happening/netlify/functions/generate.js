const SYSTEM_PROMPT = `You are the engine behind a game called "What's Also Happening." When given a film title and its metadata, your job is to identify the time period the film is SET IN (not when it was released) and produce two sections of content about that period.

If the film's time setting is ambiguous or spans multiple years, use your best judgment to anchor to the most dramatically significant period within the film.

OUTPUT STRUCTURE — follow this exactly every time:

First, on its own line, state the time period in this format:
SET IN: [location and period, e.g. "Chicago, 1936" or "New York City, early 1960s"]

Then produce two sections with these exact headers:

WHAT'S ALSO HAPPENING IN HISTORY

Four historical events, one from each of the following hemispheres:
- North America
- South America
- Europe
- Africa / Asia / Oceania (choose the most dramatically compelling region)

Each historical entry must:
- Begin with a label line in this format: [Region] — [Location], [Date or Year]
- Be grounded in a real, verifiable event from the film's time period
- Include specific dates, locations, and named figures where possible
- Be written as vivid, present-tense prose — make the reader feel like they are there
- Stand entirely alone — no connections to other entries, no connections to the film
- Be at minimum two substantial paragraphs

WHO ELSE IS OUT THERE IN FICTION

Three fictional characters from works set in the same time period as the film.

Each fictional entry must:
- Begin with a label line: [Character Name] — [Source Work], [Author/Creator], [Year]
- Come from a work that is SET IN the film's time period — not merely published then
- Come from a completely different genre than the film itself — do not echo the film's genre
- Be written as a vivid, self-contained portrait of the character and their world
- Stand entirely alone — no connections to other entries, no connections to the film

ABSOLUTE RULES — never violate these:

1. NO THESIS. Never state what entries share, mean together, or how they relate to the film.
2. NO COMPARISON. Never connect one entry to another.
3. NO WRAP-UP. Never write a closing observation that ties entries together.
4. NO GENRE ECHO. Fiction picks must come from different genres than the film.
5. NO BULLET POINTS within entries. All entries are written in prose paragraphs only.
6. SET IN, NOT PUBLISHED IN. Fictional characters must inhabit the time period.
7. STANDALONE ENTRIES ONLY. Every entry is a self-contained portrait. Full stop.

TONE: Write with energy and specificity. Specific dates, named people, real places. Present tense where it adds urgency. The goal is to make the reader feel the texture of the world the film inhabits.`;

exports.handler = async function(event, context) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let title;
  try {
    const body = JSON.parse(event.body);
    title = body.title;
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  if (!title || title.trim().length === 0) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Film title is required' }) };
  }

  const TMDB_API_KEY = process.env.TMDB_API_KEY;
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

  if (!TMDB_API_KEY || !OPENAI_API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Server configuration error.' }) };
  }

  // Step 1: TMDB lookup
  let filmData = null;
  try {
    const tmdbUrl = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(title)}&language=en-US&page=1`;
    const tmdbRes = await fetch(tmdbUrl);
    const tmdbJson = await tmdbRes.json();

    if (tmdbJson.results && tmdbJson.results.length > 0) {
      const film = tmdbJson.results[0];
      const releaseYear = film.release_date ? film.release_date.substring(0, 4) : 'Unknown';
      const genreMap = {
        28:'Action',12:'Adventure',16:'Animation',35:'Comedy',80:'Crime',
        99:'Documentary',18:'Drama',10751:'Family',14:'Fantasy',36:'History',
        27:'Horror',10402:'Music',9648:'Mystery',10749:'Romance',878:'Science Fiction',
        10770:'TV Movie',53:'Thriller',10752:'War',37:'Western'
      };
      const genres = (film.genre_ids || []).map(id => genreMap[id]).filter(Boolean);
      filmData = {
        tmdbTitle: film.title,
        releaseYear,
        genres,
        overview: film.overview || ''
      };
    }
  } catch (e) {
    filmData = null;
  }

  // Build user message for OpenAI
  let userMessage = `Film title: "${title}"`;
  if (filmData) {
    userMessage += `\nRelease year: ${filmData.releaseYear}`;
    if (filmData.genres.length > 0) userMessage += `\nGenre(s): ${filmData.genres.join(', ')}`;
    if (filmData.overview) userMessage += `\nPlot summary: ${filmData.overview}`;
  }
  userMessage += '\n\nPlease generate the full What\'s Also Happening entry for this film.';

  // Step 2: OpenAI generation
  try {
    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 2500,
        temperature: 0.7,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userMessage }
        ]
      })
    });

    if (!openaiRes.ok) {
      const errData = await openaiRes.json();
      throw new Error(errData.error?.message || 'OpenAI request failed');
    }

    const openaiJson = await openaiRes.json();
    const rawText = openaiJson.choices[0].message.content;
    const setPeriodMatch = rawText.match(/SET IN:\s*(.+)/i);
    const setPeriod = setPeriodMatch ? setPeriodMatch[1].trim() : 'period unknown';

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filmTitle: filmData ? filmData.tmdbTitle : title,
        filmYear: filmData ? filmData.releaseYear : '',
        genres: filmData ? filmData.genres : [],
        setPeriod,
        rawText
      })
    };

  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to generate entry: ' + e.message }) };
  }
};