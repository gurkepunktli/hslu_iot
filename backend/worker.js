// ============================================
// CLOUDFLARE WORKER - Bike Tracker API
// ============================================
// 
// DEPLOYMENT:
// 1. Gehe zu Cloudflare Dashboard > Workers & Pages
// 2. Create > Workers > "Create Worker"
// 3. Ersetze den Code mit diesem hier
// 4. Deploy
// 5. Gehe zu Settings > Variables und füge hinzu:
//    - AWS_ACCESS_KEY (dein AWS Access Key)
//    - AWS_SECRET_KEY (dein AWS Secret - als "Encrypt" markieren!)
//    - AWS_REGION (z.B. eu-central-1)
//    - DYNAMODB_TABLE (dein Tabellenname)
//    - ADMIN_PIN (z.B. 1234)
//
// ============================================

// Fallback-Konfiguration, falls Cloudflare-Variablen nicht verfügbar sind.
// Trage hier die Werte ein, falls sie nicht als Env-Variablen gesetzt werden können.
const DEFAULT_REGION = 'eu-central-1';
const DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/1446116774998179861/elv96aMUltKQtfLIkTDdmVGzzQXpM3nJAkN193eMmZ5LHFy4FqTHHXzkJxDT3TZTH5Yo';

function buildConfig(env) {
    const accessKey = env?.AWS_ACCESS_KEY;
    const secretKey = env?.AWS_SECRET_KEY;
    const table = env?.DYNAMODB_TABLE;
    const adminPin = env?.ADMIN_PIN;

    if (!accessKey || !secretKey || !table || !adminPin) {
        throw new Error('Missing required configuration: set AWS_ACCESS_KEY, AWS_SECRET_KEY, DYNAMODB_TABLE, ADMIN_PIN.');
    }

    return {
        AWS_ACCESS_KEY: accessKey,
        AWS_SECRET_KEY: secretKey,
        AWS_REGION: env?.AWS_REGION || DEFAULT_REGION,
        DYNAMODB_TABLE: table,
        ADMIN_PIN: adminPin
    };
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const config = buildConfig(env);
        const MAX_SCAN = 500; // number of recent records to scan for a valid fix
        
        // CORS Headers
        const corsHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Content-Type': 'application/json'
        };

        // Handle CORS preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders });
        }

        try {
            // Route: GET /api/position - Aktuelle Position
            if (url.pathname === '/api/position' && request.method === 'GET') {
                const device = url.searchParams.get('device') || 'pi9';
                const data = await queryDynamoDB(config, device, MAX_SCAN);

                if (!data.Items || data.Items.length === 0) {
                    return new Response('{}', { headers: corsHeaders });
                }

                // Get latest valid position (with GPS fix)
                const position = findLatestValidPosition(data.Items);

                // Get latest entry overall (for last update timestamp)
                const latestEntry = data.Items.length > 0 ? parseItem(data.Items[0]) : null;

                // Combine both: position data from valid fix, but include last update timestamp
                const result = {
                    ...position,
                    last_update_ts: latestEntry?.ts || position.ts
                };

                return new Response(JSON.stringify(result), { headers: corsHeaders });
            }

            // Route: GET /api/track - Letzte Positionen
            if (url.pathname === '/api/track' && request.method === 'GET') {
                const device = url.searchParams.get('device') || 'pi9';
                const limit = parseInt(url.searchParams.get('limit')) || 100;
                
                const data = await queryDynamoDB(config, device, limit);
                
                if (!data.Items) {
                    return new Response('[]', { headers: corsHeaders });
                }

                const points = data.Items
                    .map(parseItem)
                    .filter(isValidPosition);
                return new Response(JSON.stringify(points), { headers: corsHeaders });
            }

            // Route: POST /api/stolen - Diebstahl melden/aufheben
            if (url.pathname === '/api/stolen' && request.method === 'POST') {
                const body = await request.json();
                const { stolen, pin, device = 'pi9' } = body;

                // PIN prüfen
                if (pin !== config.ADMIN_PIN) {
                    return new Response(
                        JSON.stringify({ error: 'Ungültiger PIN' }),
                        { status: 401, headers: corsHeaders }
                    );
                }

                // Status in separater "Status-Tabelle" oder als Attribut speichern
                // Hier: Wir speichern in KV (einfacher)
                await env.BIKE_STATUS?.put(`stolen:${device}`, JSON.stringify({
                    stolen: stolen,
                    timestamp: new Date().toISOString()
                }));

                // Get last known GPS position for Discord notification
                let gpsData = null;
                try {
                    const posData = await queryDynamoDB(config, device, MAX_SCAN);
                    if (posData.Items && posData.Items.length > 0) {
                        gpsData = findLatestValidPosition(posData.Items);
                    }
                } catch (err) {
                    console.error('Failed to fetch GPS data for Discord:', err);
                }

                // Send Discord notification
                try {
                    const fields = [
                        {
                            name: 'Device ID',
                            value: device,
                            inline: true
                        },
                        {
                            name: 'Status',
                            value: stolen ? 'STOLEN' : 'Safe',
                            inline: true
                        }
                    ];

                    // Add GPS location if available
                    if (gpsData && gpsData.lat && gpsData.lon) {
                        const lat = gpsData.lat;
                        const lon = gpsData.lon;
                        const googleMapsUrl = `https://www.google.com/maps?q=${lat},${lon}`;

                        // Format timestamp
                        let timeStr = 'Unknown';
                        if (gpsData.ts) {
                            const ts = typeof gpsData.ts === 'string' ? parseInt(gpsData.ts) : gpsData.ts;
                            const date = new Date(ts);
                            timeStr = date.toLocaleString('de-CH', {
                                day: '2-digit',
                                month: '2-digit',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                                second: '2-digit'
                            });
                        }

                        fields.push({
                            name: '📍 Last Known Position',
                            value: `[${lat.toFixed(5)}, ${lon.toFixed(5)}](${googleMapsUrl})\n🕒 ${timeStr}`,
                            inline: false
                        });
                    } else {
                        fields.push({
                            name: '📍 GPS Position',
                            value: 'No GPS data available',
                            inline: false
                        });
                    }

                    const embed = {
                        title: stolen ? '🚨 BIKE STOLEN!' : '✅ Bike Recovered',
                        description: stolen
                            ? `⚠️ Bike **${device}** has been reported as stolen!`
                            : `🎉 Bike **${device}** has been recovered and unlocked.`,
                        color: stolen ? 0xef4444 : 0x10b981, // Red for stolen, green for recovered
                        timestamp: new Date().toISOString(),
                        fields: fields,
                        footer: {
                            text: 'Bike Tracker Alert System'
                        }
                    };

                    await fetch(DISCORD_WEBHOOK_URL, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            username: 'Bike Tracker',
                            embeds: [embed]
                        })
                    });
                } catch (discordError) {
                    console.error('Discord webhook failed:', discordError);
                    // Don't fail the whole request if Discord fails
                }

                return new Response(
                    JSON.stringify({ success: true, stolen: stolen }),
                    { headers: corsHeaders }
                );
            }

            // Route: GET /api/status - Diebstahl-Status abrufen
            if (url.pathname === '/api/status' && request.method === 'GET') {
                const device = url.searchParams.get('device') || 'pi9';
                
            const status = await env.BIKE_STATUS?.get(`stolen:${device}`);
            if (status) {
                const parsed = JSON.parse(status);
                return new Response(JSON.stringify(parsed), { headers: corsHeaders });
            }
            
            return new Response(JSON.stringify({ stolen: false }), { headers: corsHeaders });
        }

            // Route: POST /api/job/stop - Stop running scripts
            if (url.pathname === '/api/job/stop' && request.method === 'POST') {
                if (!env.JOB_QUEUE) {
                    return new Response(
                        JSON.stringify({ error: 'JOB_QUEUE not configured' }),
                        { status: 500, headers: corsHeaders }
                    );
                }

                const body = await request.json();
                const { type = 'stop_all', target = 'gateway', params = {} } = body || {};

                const jobId = crypto.randomUUID();
                const job = {
                    job_id: jobId,
                    type,
                    target,
                    params,
                    status: 'queued',
                    created_at: Date.now()
                };

                await env.JOB_QUEUE.put(`job:${jobId}`, JSON.stringify(job), { expirationTtl: 3600 });
                await env.JOB_QUEUE.put(`next:${target}`, jobId, { expirationTtl: 3600 });

                return new Response(JSON.stringify({ job_id: jobId }), { headers: corsHeaders });
            }

            // Route: POST /api/job - Job anlegen (Frontend-Button)
            if (url.pathname === '/api/job' && request.method === 'POST') {
                if (!env.JOB_QUEUE) {
                    return new Response(
                        JSON.stringify({ error: 'JOB_QUEUE not configured' }),
                        { status: 500, headers: corsHeaders }
                    );
                }

                const body = await request.json();
                const { type = 'gps_read', target = 'gateway', params = {} } = body || {};

                const jobId = crypto.randomUUID();
                const job = {
                    job_id: jobId,
                    type,
                    target,
                    params,
                    status: 'queued',
                    created_at: Date.now()
                };

                await env.JOB_QUEUE.put(`job:${jobId}`, JSON.stringify(job), { expirationTtl: 3600 });
                await env.JOB_QUEUE.put(`next:${target}`, jobId, { expirationTtl: 3600 });

                return new Response(JSON.stringify({ job_id: jobId }), { headers: corsHeaders });
            }

            // Route: GET /api/job/poll - Gateway fragt nach Arbeit
            if (url.pathname === '/api/job/poll' && request.method === 'GET') {
                if (!env.JOB_QUEUE) {
                    return new Response(
                        JSON.stringify({ error: 'JOB_QUEUE not configured' }),
                        { status: 500, headers: corsHeaders }
                    );
                }

                const piId = url.searchParams.get('pi_id');
                if (!piId) {
                    return new Response(
                        JSON.stringify({ error: 'Missing pi_id' }),
                        { status: 400, headers: corsHeaders }
                    );
                }

                const nextId = await env.JOB_QUEUE.get(`next:${piId}`);
                if (!nextId) {
                    return new Response(JSON.stringify({ job: null }), { headers: corsHeaders });
                }

                const jobRaw = await env.JOB_QUEUE.get(`job:${nextId}`);
                // Job einmalig zustellen
                await env.JOB_QUEUE.delete(`next:${piId}`);

                return new Response(
                    JSON.stringify({ job: jobRaw ? JSON.parse(jobRaw) : null }),
                    { headers: corsHeaders }
                );
            }

            // Route: POST /api/job/result - Gateway meldet Ergebnis
            if (url.pathname === '/api/job/result' && request.method === 'POST') {
                if (!env.JOB_QUEUE) {
                    return new Response(
                        JSON.stringify({ error: 'JOB_QUEUE not configured' }),
                        { status: 500, headers: corsHeaders }
                    );
                }

                const body = await request.json();
                const { job_id, status, output = '', duration_ms = 0 } = body || {};

                if (!job_id || !status) {
                    return new Response(
                        JSON.stringify({ error: 'Missing job_id or status' }),
                        { status: 400, headers: corsHeaders }
                    );
                }

                const jobRaw = await env.JOB_QUEUE.get(`job:${job_id}`);
                if (!jobRaw) {
                    return new Response(
                        JSON.stringify({ error: 'Job not found' }),
                        { status: 404, headers: corsHeaders }
                    );
                }

                const job = JSON.parse(jobRaw);
                job.status = status;
                job.output = output;
                job.duration_ms = duration_ms;
                job.finished_at = Date.now();

                await env.JOB_QUEUE.put(`job:${job_id}`, JSON.stringify(job), { expirationTtl: 86400 });

                return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
            }

            // Route: GET /api/job/status - Frontend fragt Status ab
            if (url.pathname === '/api/job/status' && request.method === 'GET') {
                if (!env.JOB_QUEUE) {
                    return new Response(
                        JSON.stringify({ error: 'JOB_QUEUE not configured' }),
                        { status: 500, headers: corsHeaders }
                    );
                }

                const jobId = url.searchParams.get('job_id');
                if (!jobId) {
                    return new Response(
                        JSON.stringify({ error: 'Missing job_id' }),
                        { status: 400, headers: corsHeaders }
                    );
                }

                const jobRaw = await env.JOB_QUEUE.get(`job:${jobId}`);
                return new Response(
                    JSON.stringify({ job: jobRaw ? JSON.parse(jobRaw) : null }),
                    { headers: corsHeaders }
                );
            }

            // 404 für unbekannte Routen
            return new Response(
                JSON.stringify({ error: 'Not found' }), 
                { status: 404, headers: corsHeaders }
            );

        } catch (error) {
            console.error('Worker error:', error);
            return new Response(
                JSON.stringify({ error: error.message }), 
                { status: 500, headers: corsHeaders }
            );
        }
    }
};

// DynamoDB Query ausführen
async function queryDynamoDB(config, device, limit) {
    const region = config.AWS_REGION || 'eu-central-1';
    const tableName = config.DYNAMODB_TABLE;
    
    const endpoint = `https://dynamodb.${region}.amazonaws.com`;
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);

    const requestBody = JSON.stringify({
        TableName: tableName,
        KeyConditionExpression: 'device = :dev',
        ExpressionAttributeValues: {
            ':dev': { S: device }
        },
        ScanIndexForward: false,
        Limit: limit
    });

    // AWS Signature Version 4
    const headers = await signRequest(
        config,
        'POST',
        endpoint,
        '/',
        requestBody,
        'dynamodb',
        region,
        amzDate,
        dateStamp
    );

    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            ...headers,
            'Content-Type': 'application/x-amz-json-1.0',
            'X-Amz-Target': 'DynamoDB_20120810.Query'
        },
        body: requestBody
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`DynamoDB error: ${error}`);
    }

    return response.json();
}

// AWS Signature V4
async function signRequest(config, method, endpoint, path, body, service, region, amzDate, dateStamp) {
    const url = new URL(endpoint);
    const host = url.host;

    const canonicalHeaders = `host:${host}\nx-amz-date:${amzDate}\n`;
    const signedHeaders = 'host;x-amz-date';

    const bodyHash = await sha256(body);
    const canonicalRequest = `${method}\n${path}\n\n${canonicalHeaders}\n${signedHeaders}\n${bodyHash}`;

    const algorithm = 'AWS4-HMAC-SHA256';
    const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
    const stringToSign = `${algorithm}\n${amzDate}\n${credentialScope}\n${await sha256(canonicalRequest)}`;

    const signingKey = await getSignatureKey(config.AWS_SECRET_KEY, dateStamp, region, service);
    const signature = await hmacHex(signingKey, stringToSign);

    const authorizationHeader = `${algorithm} Credential=${config.AWS_ACCESS_KEY}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    return {
        'Authorization': authorizationHeader,
        'X-Amz-Date': amzDate,
        'Host': host
    };
}

async function getSignatureKey(key, dateStamp, region, service) {
    const kDate = await hmac('AWS4' + key, dateStamp);
    const kRegion = await hmac(kDate, region);
    const kService = await hmac(kRegion, service);
    const kSigning = await hmac(kService, 'aws4_request');
    return kSigning;
}

async function hmac(key, data) {
    const keyData = typeof key === 'string' ? new TextEncoder().encode(key) : key;
    const cryptoKey = await crypto.subtle.importKey(
        'raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const signature = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data));
    return new Uint8Array(signature);
}

async function hmacHex(key, data) {
    const signature = await hmac(key, data);
    return Array.from(signature).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function sha256(message) {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// DynamoDB Item parsen
function parseItem(item) {
    try {
        const payload = item.payload?.M || item.payload || item;

        // Support both formats:
        // - Original: lon, speed_kn, course_deg
        // - Alternative: long (instead of lon), no speed/course
        const lon = parseFloat(
            payload?.lon?.N ?? payload?.lon ??
            payload?.long?.N ?? payload?.long ??
            item.lon?.N ?? item.lon ??
            item.long?.N ?? item.long ??
            0
        );

        return {
            lat: parseFloat(payload?.lat?.N ?? payload?.lat ?? item.lat?.N ?? item.lat ?? 0),
            lon: lon,
            speed: parseFloat(payload?.speed_kn?.N ?? payload?.speed_kn ?? item.speed_kn?.N ?? item.speed_kn ?? 0),
            course: parseFloat(payload?.course_deg?.N ?? payload?.course_deg ?? item.course_deg?.N ?? item.course_deg ?? 0),
            fix: payload?.fix?.BOOL ?? payload?.fix ?? item.fix?.BOOL ?? item.fix,
            ts: item.ts?.S || item.ts?.N || item.ts,
            device: item.device?.S || item.device
        };
    } catch (e) {
        console.error('Parse error:', e, item);
        return {};
    }
}

function isValidPosition(pos) {
    const hasFix = pos?.fix !== false; // reject explicit false; allow true/undefined
    const latOk = Number.isFinite(pos?.lat);
    const lonOk = Number.isFinite(pos?.lon);
    const notZero = pos?.lat !== 0 || pos?.lon !== 0;
    return hasFix && latOk && lonOk && notZero;
}

function findLatestValidPosition(items) {
    if (!Array.isArray(items) || items.length === 0) return {};
    for (const item of items) {
        const parsed = parseItem(item);
        if (isValidPosition(parsed)) {
            return parsed;
        }
    }
    // Fallback: kein gültiger Fix gefunden
    return {};
}
