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

    // GET routes
    if (request.method === 'GET') {
      switch (path) {
        case '/archive':
          return handleGetArchive(env, corsHeaders);
        case '/comments':
          return handleGetComments(env, corsHeaders);
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
        return handleSetArchive(request, env, corsHeaders);
      case '/comments':
        return handleAddComment(request, env, corsHeaders);
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

// Get archived property IDs
async function handleGetArchive(env, corsHeaders) {
  const data = await env.ARCHIVE_STATE.get('cyprus-villas-archived', 'json');
  return new Response(
    JSON.stringify(data || []),
    { headers: { 'Content-Type': 'application/json', ...corsHeaders } }
  );
}

// Set archived property IDs
async function handleSetArchive(request, env, corsHeaders) {
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
  await env.ARCHIVE_STATE.put('cyprus-villas-archived', JSON.stringify(sanitized));

  return new Response(
    JSON.stringify({ success: true, archived: sanitized }),
    { headers: { 'Content-Type': 'application/json', ...corsHeaders } }
  );
}

// Get all comments
async function handleGetComments(env, corsHeaders) {
  const data = await env.ARCHIVE_STATE.get('cyprus-villas-comments', 'json');
  return new Response(
    JSON.stringify(data || {}),
    { headers: { 'Content-Type': 'application/json', ...corsHeaders } }
  );
}

// Add a comment to a property
async function handleAddComment(request, env, corsHeaders) {
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

  // Load existing comments
  const comments = await env.ARCHIVE_STATE.get('cyprus-villas-comments', 'json') || {};

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

  await env.ARCHIVE_STATE.put('cyprus-villas-comments', JSON.stringify(comments));

  return new Response(
    JSON.stringify({ success: true, comments: comments[sanitizedPropertyId] }),
    { headers: { 'Content-Type': 'application/json', ...corsHeaders } }
  );
}
