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
                const data = await queryDynamoDB(config, device, 1);
                
                if (!data.Items || data.Items.length === 0) {
                    return new Response('{}', { headers: corsHeaders });
                }

                const item = data.Items[0];
                const position = parseItem(item);
                
                return new Response(JSON.stringify(position), { headers: corsHeaders });
            }

            // Route: GET /api/track - Letzte Positionen
            if (url.pathname === '/api/track' && request.method === 'GET') {
                const device = url.searchParams.get('device') || 'pi9';
                const limit = parseInt(url.searchParams.get('limit')) || 100;
                
                const data = await queryDynamoDB(config, device, limit);
                
                if (!data.Items) {
                    return new Response('[]', { headers: corsHeaders });
                }

                const points = data.Items.map(parseItem);
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
        const payload = item.payload?.M || item.payload;
        
        return {
            lat: parseFloat(payload?.lat?.N || payload?.lat || 0),
            lon: parseFloat(payload?.lon?.N || payload?.lon || 0),
            speed: parseFloat(payload?.speed_kn?.N || payload?.speed_kn || 0),
            course: parseFloat(payload?.course_deg?.N || payload?.course_deg || 0),
            ts: item.ts?.S || item.ts?.N || item.ts,
            device: item.device?.S || item.device
        };
    } catch (e) {
        console.error('Parse error:', e, item);
        return {};
    }
}
