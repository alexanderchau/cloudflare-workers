export default {
  async fetch(request, env) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: corsHeaders });
    }

    // Route by path
    const url = new URL(request.url);
    const path = url.pathname;

    switch (path) {
      case '/':
      case '/trigger-workflow':
        return handleTriggerWorkflow(env, corsHeaders);
      case '/create-issue':
        return handleCreateIssue(request, env, corsHeaders);
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
