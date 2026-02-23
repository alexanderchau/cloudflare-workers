export default {
  async fetch(request, env) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Route by path
    const url = new URL(request.url);
    const path = url.pathname;
    const trip = url.searchParams.get('trip') || '';

    // GET routes
    if (request.method === 'GET') {
      switch (path) {
        case '/archive':
          return handleGetArchive(env, corsHeaders, trip);
        case '/comments':
          return handleGetComments(env, corsHeaders, trip);
        case '/votes':
          return handleGetVotes(env, corsHeaders, trip);
        case '/trips':
          return handleGetTrips(env, corsHeaders);
        default:
          return new Response(JSON.stringify({ error: 'Not found' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
      }
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: corsHeaders });
    }

    switch (path) {
      case '/':
      case '/trigger-workflow':
        return handleTriggerWorkflow(env, corsHeaders);
      case '/create-issue':
        return handleCreateIssue(request, env, corsHeaders);
      case '/archive':
        return handleSetArchive(request, env, corsHeaders, trip);
      case '/comments':
        return handleAddComment(request, env, corsHeaders, trip);
      case '/votes':
        return handleSetVotes(request, env, corsHeaders, trip);
      case '/trips':
        return handleSetTrips(request, env, corsHeaders);
      default:
        return new Response(JSON.stringify({ error: 'Not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
    }
  },
};

// Trigger GitHub workflow (existing functionality)
async function handleTriggerWorkflow(env, corsHeaders) {
  const response = await fetch(
    'https://api.github.com/repos/alexanderchau/training-dashboard/actions/workflows/update-oura-data.yml/dispatches',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'training-dashboard-worker',
      },
      body: JSON.stringify({ ref: 'main' }),
    }
  );

  return new Response(
    JSON.stringify({ success: response.status === 204 }),
    {
      status: response.status === 204 ? 200 : response.status,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    }
  );
}

// Create GitHub issue (for cyprus-villas property submissions)
async function handleCreateIssue(request, env, corsHeaders) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ error: 'Invalid JSON body' }),
      { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
    );
  }

  const { repo, title, issueBody, labels } = body;

  // Validate required fields
  if (!repo || !title) {
    return new Response(
      JSON.stringify({ error: 'Missing required fields: repo, title' }),
      { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
    );
  }

  // Only allow specific repos for security
  const allowedRepos = ['alexanderchau/cyprus-villas-2026', 'alexanderchau/training-dashboard'];
  if (!allowedRepos.includes(repo)) {
    return new Response(
      JSON.stringify({ error: 'Repository not allowed' }),
      { status: 403, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
    );
  }

  const response = await fetch(
    `https://api.github.com/repos/${repo}/issues`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'training-dashboard-worker',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title,
        body: issueBody || '',
        labels: labels || [],
      }),
    }
  );

  const data = await response.json();

  if (response.status === 201) {
    return new Response(
      JSON.stringify({ success: true, issueUrl: data.html_url, issueNumber: data.number }),
      { status: 201, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
    );
  } else {
    return new Response(
      JSON.stringify({ success: false, error: data.message || 'Failed to create issue' }),
      { status: response.status, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
    );
  }
}

// KV key helper: trip-scoped keys with fallback to bare keys for migration
function kvKey(base, trip) {
  return trip ? `${trip}:${base}` : base;
}

async function kvGetWithFallback(env, base, trip, defaultVal) {
  const scopedKey = kvKey(base, trip);
  let data = await env.ARCHIVE_STATE.get(scopedKey, 'json');
  if (data !== null) return data;
  // Fallback: read bare key (migration for pre-trip data)
  if (trip) {
    data = await env.ARCHIVE_STATE.get(base, 'json');
    if (data !== null) return data;
  }
  return defaultVal;
}

// Get archived property IDs
async function handleGetArchive(env, corsHeaders, trip) {
  const data = await kvGetWithFallback(env, 'cyprus-villas-archived', trip, []);
  return new Response(
    JSON.stringify(data),
    { headers: { 'Content-Type': 'application/json', ...corsHeaders } }
  );
}

// Set archived property IDs
async function handleSetArchive(request, env, corsHeaders, trip) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ error: 'Invalid JSON body' }),
      { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
    );
  }

  if (!Array.isArray(body)) {
    return new Response(
      JSON.stringify({ error: 'Body must be an array of property IDs' }),
      { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
    );
  }

  // Sanitize: only allow strings, max 100 items
  const sanitized = body.filter(id => typeof id === 'string').slice(0, 100);
  await env.ARCHIVE_STATE.put(kvKey('cyprus-villas-archived', trip), JSON.stringify(sanitized));

  return new Response(
    JSON.stringify({ success: true, archived: sanitized }),
    { headers: { 'Content-Type': 'application/json', ...corsHeaders } }
  );
}

// Get all comments
async function handleGetComments(env, corsHeaders, trip) {
  const data = await kvGetWithFallback(env, 'cyprus-villas-comments', trip, {});
  return new Response(
    JSON.stringify(data),
    { headers: { 'Content-Type': 'application/json', ...corsHeaders } }
  );
}

// Add a comment to a property
async function handleAddComment(request, env, corsHeaders, trip) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ error: 'Invalid JSON body' }),
      { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
    );
  }

  const { propertyId, user, color, text } = body;

  if (!propertyId || !user || !text) {
    return new Response(
      JSON.stringify({ error: 'Missing required fields: propertyId, user, text' }),
      { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
    );
  }

  // Sanitize inputs
  const sanitizedUser = String(user).slice(0, 50);
  const sanitizedText = String(text).slice(0, 500);
  const sanitizedColor = String(color || '#717171').slice(0, 20);
  const sanitizedPropertyId = String(propertyId).slice(0, 100);

  // Load existing comments (trip-scoped)
  const key = kvKey('cyprus-villas-comments', trip);
  const comments = await kvGetWithFallback(env, 'cyprus-villas-comments', trip, {});

  // Add new comment
  if (!comments[sanitizedPropertyId]) {
    comments[sanitizedPropertyId] = [];
  }

  comments[sanitizedPropertyId].push({
    user: sanitizedUser,
    color: sanitizedColor,
    text: sanitizedText,
    timestamp: Date.now(),
  });

  // Cap at 50 comments per property
  if (comments[sanitizedPropertyId].length > 50) {
    comments[sanitizedPropertyId] = comments[sanitizedPropertyId].slice(-50);
  }

  await env.ARCHIVE_STATE.put(key, JSON.stringify(comments));

  return new Response(
    JSON.stringify({ success: true, comments: comments[sanitizedPropertyId] }),
    { headers: { 'Content-Type': 'application/json', ...corsHeaders } }
  );
}

// Get all votes: { userId: { name, color, votes: [propertyId, ...] } }
async function handleGetVotes(env, corsHeaders, trip) {
  const data = await kvGetWithFallback(env, 'cyprus-villas-votes', trip, {});
  return new Response(
    JSON.stringify(data),
    { headers: { 'Content-Type': 'application/json', ...corsHeaders } }
  );
}

// Set votes for a user (replaces their votes)
async function handleSetVotes(request, env, corsHeaders, trip) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ error: 'Invalid JSON body' }),
      { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
    );
  }

  const { userId, name, color, votes } = body;

  if (!userId || !name || !Array.isArray(votes)) {
    return new Response(
      JSON.stringify({ error: 'Missing required fields: userId, name, votes[]' }),
      { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
    );
  }

  // Sanitize: max 3 votes per user, strings only
  const sanitizedVotes = votes.filter(id => typeof id === 'string').slice(0, 3);

  const key = kvKey('cyprus-villas-votes', trip);
  const allVotes = await kvGetWithFallback(env, 'cyprus-villas-votes', trip, {});
  allVotes[String(userId).slice(0, 100)] = {
    name: String(name).slice(0, 50),
    color: String(color || '#717171').slice(0, 20),
    votes: sanitizedVotes,
  };

  await env.ARCHIVE_STATE.put(key, JSON.stringify(allVotes));

  return new Response(
    JSON.stringify({ success: true, votes: allVotes }),
    { headers: { 'Content-Type': 'application/json', ...corsHeaders } }
  );
}

// Get trips list
async function handleGetTrips(env, corsHeaders) {
  const data = await env.ARCHIVE_STATE.get('cyprus-villas-trips', 'json');
  return new Response(
    JSON.stringify(data || []),
    { headers: { 'Content-Type': 'application/json', ...corsHeaders } }
  );
}

// Save trips list
async function handleSetTrips(request, env, corsHeaders) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ error: 'Invalid JSON body' }),
      { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
    );
  }

  if (!Array.isArray(body)) {
    return new Response(
      JSON.stringify({ error: 'Body must be an array of trip objects' }),
      { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
    );
  }

  // Sanitize: max 20 trips, validate shape
  const sanitized = body.slice(0, 20).map(t => ({
    id: String(t.id || '').slice(0, 100),
    name: String(t.name || '').slice(0, 100),
    createdAt: Number(t.createdAt) || Date.now(),
  })).filter(t => t.id && t.name);

  await env.ARCHIVE_STATE.put('cyprus-villas-trips', JSON.stringify(sanitized));

  return new Response(
    JSON.stringify({ success: true, trips: sanitized }),
    { headers: { 'Content-Type': 'application/json', ...corsHeaders } }
  );
}
