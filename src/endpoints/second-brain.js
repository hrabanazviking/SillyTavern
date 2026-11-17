import express from 'express';

import { gatewayFromEnv } from '../second-brain/gateway-core.js';

export const router = express.Router();

// Read-only all-collections gateway (RFST-011). Mounted at
// /api/second-brain. Only GET search / chunk / overview / health
// exist here; the core rejects every write verb and every other
// path before any upstream call. Upstream configuration comes from
// the server environment only (SECOND_BRAIN_URL +
// SECOND_BRAIN_READ_TOKEN); the token never reaches the browser.
const gateway = gatewayFromEnv();

router.all('*', async (request, response) => {
    const result = await gateway.handle(request.method, request.path, request.query || {});
    return response.status(result.status).json(result.body);
});
