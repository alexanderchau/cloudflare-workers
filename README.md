# Cloudflare Workers - Personal API

Serverless API proxy for personal projects.

## Endpoints

| Path | Method | Description |
|------|--------|-------------|
| `/trigger-workflow` | POST | Triggers training-dashboard Oura data update workflow |
| `/create-issue` | POST | Creates GitHub issue (whitelisted repos only) |

## Create Issue

```bash
curl -X POST https://alex-api.alexanderchau01.workers.dev/create-issue \
  -H "Content-Type: application/json" \
  -d '{
    "repo": "alexanderchau/cyprus-villas-2026",
    "title": "[Property] Villa Name",
    "issueBody": "### Property URL\nhttps://...",
    "labels": ["property-request"]
  }'
```

**Allowed repos:** `alexanderchau/cyprus-villas-2026`, `alexanderchau/training-dashboard`

## Deployment

```bash
# Deploy
npx wrangler deploy

# Set secrets
npx wrangler secret put GITHUB_TOKEN
```

## Used by

- [cyprus-villas-2026](https://github.com/alexanderchau/cyprus-villas-2026) - Property submission
- [training-dashboard](https://github.com/alexanderchau/training-dashboard) - Oura data refresh
