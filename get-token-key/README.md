# IVS RealTime Token Generator with Key-Based JWT Signing

This project implements a secure token generation system for AWS IVS RealTime using **key-based JWT signing** with geo-blocking and origin checking at the API Gateway level using AWS WAF.

## Architecture

### High-Level Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                         User Browser                                │
│                     (Singapore, localhost:3000)                     │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 │ 1. Click "Join Stage"
                                 │    POST /token
                                 │    Origin: http://localhost:3000
                                 │    Source IP: 203.0.113.45 (SG)
                                 ↓
┌─────────────────────────────────────────────────────────────────────┐
│                    AWS WAF (Web Application Firewall)               │
│                     ⚡ SECURITY LAYER - API GATEWAY LEVEL           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Rule 1: Allow OPTIONS Method (Priority 1)                         │
│  ├─ Check: HTTP Method = OPTIONS?                                  │
│  └─ Action: Allow (for CORS preflight)                             │
│                                                                     │
│  Rule 2: Geo-blocking AND Origin Check (Priority 2)                │
│  ├─ Check 1: Country Code in [HK, US, CA, GB, SG]?                │
│  │   └─ Source: Request IP → Country Code                          │
│  │                                                                  │
│  ├─ Check 2: Origin = "http://localhost:3000"?                     │
│  │   └─ Source: Origin Header (exact match, case-insensitive)      │
│  │                                                                  │
│  └─ Logic: Check 1 AND Check 2 must BOTH pass                      │
│      ├─ ✅ Both Pass → Allow → Forward to API Gateway              │
│      └─ ❌ Either Fails → Block → Return 403 Forbidden             │
│                                                                     │
│  Default Action: Block (if no rules match)                         │
│                                                                     │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 │ 2. WAF Allows Request
                                 │    (Both geo & origin checks passed)
                                 ↓
┌─────────────────────────────────────────────────────────────────────┐
│                      API Gateway (REST API)                         │
│                         /prod/token endpoint                        │
├─────────────────────────────────────────────────────────────────────┤
│  • Receives validated request from WAF                              │
│  • Handles CORS (OPTIONS method)                                    │
│  • Invokes Lambda function (AWS_PROXY integration)                  │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 │ 3. Invoke Lambda
                                 │    Event: { headers, requestContext, ... }
                                 ↓
┌─────────────────────────────────────────────────────────────────────┐
│                    Lambda Function (Node.js 20.x)                   │
│                      IVSTokenGeneratorKey                           │
├─────────────────────────────────────────────────────────────────────┤
│  const jwt = require('jsonwebtoken');                               │
│  const payload = {                                                  │
│    "aws:channel-arn": stageArn,                                     │
│    "aws:access-control-allow-origin": origin,                       │
│    "exp": Math.floor(Date.now() / 1000) + (60 * 60)                │
│  };                                                                 │
│  const token = jwt.sign(payload, privateKey, {                      │
│    algorithm: 'ES384'                                               │
│  });                                                                │
│  return { token };                                                  │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 │ 4. Return Token (No AWS API Call!)
                                 │    { token: "eyJhbGc..." }
                                 ↓
┌─────────────────────────────────────────────────────────────────────┐
│                         Lambda Response                             │
│  {                                                                  │
│    statusCode: 200,                                                 │
│    headers: {                                                       │
│      "Access-Control-Allow-Origin": "http://localhost:3000"         │
│    },                                                               │
│    body: JSON.stringify({ token: "eyJhbGc..." })                    │
│  }                                                                  │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 │ 5. Return to Browser
                                 ↓
┌─────────────────────────────────────────────────────────────────────┐
│                         User Browser                                │
│  • Receives token                                                   │
│  • Creates IVS Stage instance with token                            │
│  • Joins stage: stage.join()                                        │
│  • Connects to IVS RealTime streaming                               │
│  • Video starts playing                                             │
└─────────────────────────────────────────────────────────────────────┘
```

### Key Differences from API-Based Approach

| Feature | API-Based | Key-Based (This Implementation) |
|---------|-----------|--------------------------------|
| **Dependencies** | `@aws-sdk/client-ivs-realtime` | `jsonwebtoken` |
| **IAM Permissions** | Requires `ivs:CreateParticipantToken` | None (only Lambda execution) |
| **Token Generation** | AWS API call to IVS service | Local JWT signing with ES384 |
| **Private Key** | Not needed | Required (PEM format) |
| **Performance** | Network call to AWS (~100-200ms) | Local signing (~10-20ms) |
| **Cost** | API call charges | No API charges |
| **Latency** | Higher (network round-trip) | Lower (local computation) |

### Security Enforcement Points

**1. WAF (Primary Security Layer)**
- ✅ Geo-blocking: Blocks requests from non-allowed countries
- ✅ Origin validation: Blocks requests from unauthorized domains
- ✅ Evaluated BEFORE reaching API Gateway or Lambda
- ✅ No compute cost for blocked requests
- ✅ CloudWatch metrics for monitoring

**2. API Gateway**
- ✅ CORS handling
- ✅ Request/response transformation
- ✅ Throttling and rate limiting (optional)

**3. Lambda Function**
- ✅ No validation logic needed (WAF handles it)
- ✅ Only signs JWT tokens locally
- ✅ Minimal code = faster execution
- ✅ No AWS API calls = lower latency

**4. IAM Permissions**
- ✅ Lambda only needs basic execution role
- ✅ No IVS permissions required
- ✅ Reduced attack surface

### Request Flow Examples

#### ✅ Allowed Request (Singapore + localhost:3000)
```
Request: POST /token
Origin: http://localhost:3000
Source IP: 203.0.113.45 (Singapore)

WAF Rule 1: OPTIONS? No, skip
WAF Rule 2: 
  - Country = SG? ✅ Yes (in allowed list)
  - Origin = http://localhost:3000? ✅ Yes (exact match)
  - Both pass? ✅ Yes
  → Action: Allow

API Gateway → Lambda → JWT Sign (local) → Return Token ✅
```

#### ❌ Blocked Request (China + localhost:3000)
```
Request: POST /token
Origin: http://localhost:3000
Source IP: 198.51.100.23 (China)

WAF Rule 1: OPTIONS? No, skip
WAF Rule 2:
  - Country = CN? ❌ No (not in allowed list)
  - Origin = http://localhost:3000? ✅ Yes
  - Both pass? ❌ No (country check failed)
  → Action: Block

Response: 403 Forbidden ❌
Lambda never invoked (no cost)
```

#### ❌ Blocked Request (Singapore + wrong origin)
```
Request: POST /token
Origin: https://malicious-site.com
Source IP: 203.0.113.45 (Singapore)

WAF Rule 1: OPTIONS? No, skip
WAF Rule 2:
  - Country = SG? ✅ Yes (in allowed list)
  - Origin = http://localhost:3000? ❌ No (doesn't match)
  - Both pass? ❌ No (origin check failed)
  → Action: Block

Response: 403 Forbidden ❌
Lambda never invoked (no cost)
```

### Why Key-Based JWT Signing?

| Aspect | Key-Based | API-Based |
|--------|-----------|-----------|
| **Performance** | ⚡ 10-20ms (local signing) | 🐌 100-200ms (API call) |
| **Cost** | 💰 Lambda only (~$0.20/1M) | 💸 Lambda + API calls |
| **Latency** | 🚀 Minimal | 🐌 Network round-trip |
| **Scalability** | 🚀 No API rate limits | 🐌 IVS API throttling |
| **Offline** | ✅ Works without AWS API | ❌ Requires AWS connectivity |
| **Complexity** | 🔧 Requires private key management | ✅ Simpler (no keys) |

### Components

```
infrastructure/template.yaml
├── WAF Web ACL (AWS::WAFv2::WebACL)
│   ├── Rule 1: Allow OPTIONS
│   └── Rule 2: Geo + Origin (AND logic)
├── API Gateway (AWS::ApiGateway::RestApi)
│   ├── Resource: /token
│   ├── Method: POST (AWS_PROXY to Lambda)
│   └── Method: OPTIONS (CORS)
├── Lambda Function (AWS::Lambda::Function)
│   ├── Runtime: Node.js 20.x
│   ├── Handler: tokenGenerator.handler
│   └── Environment: STAGE_ARN, PRIVATE_KEY
└── IAM Role (AWS::IAM::Role)
    └── Policy: Basic Lambda execution only

lambda/tokenGenerator.js
└── JWT signing with jsonwebtoken (ES384)

private-key-public-key.pem
└── Private key for JWT signing
```

## Features

- **Key-Based JWT Signing**: Signs tokens locally using ES384 algorithm
- **Origin Validation**: Only allows requests from specified domains (enforced by WAF)
- **Geo-blocking**: Restricts access based on country codes (enforced by WAF)
- **Secure Token Generation**: Creates IVS participant tokens without AWS API calls
- **CORS Support**: Proper CORS headers for browser requests
- **Lower Latency**: Faster token generation (no network calls)
- **Cost Effective**: No IVS API charges

## Deployment Guide (AWS Console)

### Step 1: Prepare Lambda Function Package

1. Navigate to the `lambda` folder:
   ```bash
   cd lambda
   npm install --production
   ```

2. Create a ZIP file with the Lambda code:
   ```bash
   zip -r function.zip tokenGenerator.js package.json node_modules/
   ```

3. The `function.zip` file is now ready for upload

### Step 2: Prepare Private Key

1. **Read your private key**:
   ```bash
   cat private-key-public-key.pem
   ```

2. **Copy the entire key** (including the BEGIN and END PRIVATE KEY markers)

3. **Keep it ready** - you'll paste it in CloudFormation parameters (it will be stored securely in AWS Secrets Manager)

### Step 3: Get Your Public Key ARN

You need to import your public key to IVS to get the public key ARN.

1. **Import the public key to IVS**:
   ```bash
   aws ivs import-public-key \
     --public-key-material file://get-token-key/private-key-public-key.pem \
     --region us-east-1
   ```

2. **Copy the ARN from the response**:
   ```json
   {
     "publicKey": {
       "arn": "arn:aws:ivs:us-east-1:385085470441:public-key/YFHfoNuk1NyV",
       "name": "",
       "publicKeyMaterial": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n",
       "fingerprint": "...",
       "tags": {}
     }
   }
   ```

3. **Keep the ARN ready** - you'll need it for CloudFormation parameters (e.g., `arn:aws:ivs:us-east-1:385085470441:public-key/YFHfoNuk1NyV`)

### Step 4: Deploy CloudFormation Stack

1. **Open AWS Console** → CloudFormation → Create Stack

2. **Upload Template**:
   - Choose "Upload a template file"
   - Select `infrastructure/template.yaml`
   - Click "Next"

3. **Configure Stack Parameters**:
   - **Stack name**: `ivs-token-generator-key`
   - **StageArn**: `arn:aws:ivs:us-east-1:385085470441:stage/Lem70VypWv33`
   - **PublicKeyArn**: `arn:aws:ivs:us-east-1:385085470441:public-key/YFHfoNuk1NyV` (from Step 3)
   - **PrivateKey**: Paste your entire private key (from Step 2)
   - **AllowedOrigins**: `http://localhost:3000`
   - **AllowedCountries**: `HK,US,CA,GB,SG` (add more as needed)
   - Click "Next"

4. **Configure Stack Options**:
   - Leave defaults or add tags if needed
   - Click "Next"

5. **Review**:
   - Check "I acknowledge that AWS CloudFormation might create IAM resources"
   - Click "Submit"

6. **Wait for Completion**:
   - Status will change from `CREATE_IN_PROGRESS` to `CREATE_COMPLETE`
   - This takes 2-5 minutes

### Step 5: Upload Lambda Function Code

1. **Go to Lambda Console** → Functions → `IVSTokenGeneratorKey`

2. **Upload Code**:
   - Click "Upload from" → ".zip file"
   - Select the `function.zip` you created in Step 1
   - Click "Save"

3. **Verify Environment Variables**:
   - Go to "Configuration" → "Environment variables"
   - Confirm these are set:
     - `STAGE_ARN`: Your IVS Stage ARN
     - `PUBLIC_KEY_ARN`: Your public key ARN (from Step 3)
     - `SECRET_NAME`: The Secrets Manager secret name (ivs-realtime-private-key)

4. **Verify Secrets Manager**:
   - Go to AWS Secrets Manager Console
   - Find secret named `ivs-realtime-private-key`
   - Verify it contains your private key

### Step 6: Get API Endpoint

1. **Go to CloudFormation** → Stacks → `ivs-token-generator-key`

2. **Click "Outputs" tab**

3. **Copy the API Endpoint URL**:
   - Key: `ApiEndpoint`
   - Value: `https://xxxxxxxxxx.execute-api.us-east-1.amazonaws.com/prod/token`

### Step 7: Update Player Configuration

1. **Open `Player/player.js`**

2. **Update API endpoint** (around line 38):
   ```javascript
   const API_ENDPOINT = 'https://xxxxxxxxxx.execute-api.us-east-1.amazonaws.com/prod/token';
   ```

3. **Enable automatic token fetching** (around line 100):
   Uncomment these lines:
   ```javascript
   if (!token) {
     token = await fetchTokenFromAPI();
   }
   ```

### Step 8: Test the Deployment

#### Test API Directly:
```bash
curl -X POST https://xxxxxxxxxx.execute-api.us-east-1.amazonaws.com/prod/token \
  -H "Origin: http://localhost:3000" \
  -H "Content-Type: application/json"
```

Expected response:
```json
{
  "token": "eyJhbGciOiJFUzM4NCIsInR5cCI6IkpXVCJ9..."
}
```

#### Test with Player:
1. Open `Player/player.html` in a browser (use a local server)
2. Leave the token field empty
3. Click submit
4. Token will be fetched automatically from your API

#### Test Geo-blocking:
- Use a VPN to connect from a non-allowed country
- Request should be blocked with 403 Forbidden

#### Test Origin Check:
```bash
# This should be blocked (wrong origin)
curl -X POST https://xxxxxxxxxx.execute-api.us-east-1.amazonaws.com/prod/token \
  -H "Origin: https://malicious-site.com"
```

## Security Features (API Gateway Level)

### WAF Rules Applied:

1. **CORS Preflight Rule (Priority 1)**
   - Allows OPTIONS method
   - Enables browser CORS requests

2. **Geo-blocking AND Origin Validation Rule (Priority 2)**
   - Checks request country code (only allows: HK, US, CA, GB, SG)
   - Checks Origin header (only allows configured origins)
   - Both checks must pass
   - Request never reaches Lambda if blocked

3. **Default Action: Block**
   - All other requests are blocked

### Private Key Security:

- Private key stored in **AWS Secrets Manager** (encrypted at rest with AWS KMS)
- Lambda retrieves key at runtime using IAM permissions
- Key is cached in Lambda memory for performance
- Never exposed in logs, environment variables, or responses
- Automatic encryption and access control via IAM
- Supports key rotation through Secrets Manager
- Audit trail via CloudTrail for all secret access

## Token Payload Structure

```javascript
{
  "aws:channel-arn": "arn:aws:ivs:us-east-1:385085470441:stage/Lem70VypWv33",
  "aws:access-control-allow-origin": "http://localhost:3000",
  "exp": 1737590400  // Unix timestamp (5 seconds from now)
}
```

## Monitoring

### CloudWatch Metrics:
1. **WAF Metrics**:
   - AWS Console → WAF & Shield → Web ACLs → `IVSTokenAPIKeyWebACL`
   - View blocked/allowed requests by rule
   - See geo-blocking statistics

2. **Lambda Logs**:
   - AWS Console → CloudWatch → Log groups → `/aws/lambda/IVSTokenGeneratorKey`
   - View token generation requests
   - Debug errors

3. **API Gateway Logs**:
   - AWS Console → CloudWatch → Log groups → `/aws/apigateway/[API-ID]`
   - View all API requests
   - Monitor performance

## Configuration

### Add More Countries:
Update CloudFormation parameter `AllowedCountries`:
```
HK,US,CA,GB,SG,JP,KR,AU,NZ
```

### Add More Origins:
Update CloudFormation parameter `AllowedOrigins`:
```
http://localhost:3000,http://localhost:8000,http://127.0.0.1:3000
```

### Change Token Expiration:
Edit `lambda/tokenGenerator.js`:
```javascript
"exp": Math.floor(Date.now() / 1000) + 5  // 5 seconds (current setting)
// Change to:
"exp": Math.floor(Date.now() / 1000) + (30 * 60)  // 30 minutes
// Or:
"exp": Math.floor(Date.now() / 1000) + (60 * 60)  // 1 hour
```

**Note**: You need to update the CloudFormation stack to apply parameter changes.

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| 403 Forbidden | Wrong origin or blocked country | Check WAF rules and your location |
| 500 Internal Error | Lambda error or invalid private key | Check CloudWatch logs for Lambda |
| CORS Error | Origin not in allowed list | Add origin to AllowedOrigins parameter |
| Token expired | Token older than 5 seconds | Generate new token |
| Invalid signature | Wrong private key or algorithm | Verify private key in Secrets Manager (ES384) |
| No response | API Gateway issue | Check API Gateway logs |
| Secrets Manager error | Missing permissions or secret | Verify Lambda has secretsmanager:GetSecretValue permission |

## Cost Estimate

- **Lambda**: ~$0.20 per 1M requests (faster execution than API-based)
- **API Gateway**: ~$3.50 per 1M requests
- **WAF**: ~$5/month + $1 per 1M requests
- **Secrets Manager**: ~$0.40/month per secret + $0.05 per 10,000 API calls
- **CloudWatch Logs**: ~$0.50/GB
- **IVS API Calls**: $0 (no API calls!)

**Typical monthly cost for 100K requests**: ~$5-9 (includes Secrets Manager)

## Cleanup

To remove all resources:

1. Go to CloudFormation Console
2. Select `ivs-token-generator-key` stack
3. Click "Delete"
4. Confirm deletion

This will remove:
- Lambda function
- API Gateway
- WAF Web ACL
- IAM roles
- Secrets Manager secret
- CloudWatch log groups

## Architecture Details

### Why Key-Based JWT Signing?

**Benefits**:
- ✅ No AWS API calls (lower latency, lower cost)
- ✅ Faster token generation (~10-20ms vs ~100-200ms)
- ✅ No IVS API rate limits
- ✅ Works offline (no AWS connectivity needed)
- ✅ Simpler IAM permissions
- ✅ Secure key storage with AWS Secrets Manager

**Trade-offs**:
- ❌ Requires private key management
- ❌ Need to rotate keys manually (or use Secrets Manager rotation)
- ✅ Private key secured in Secrets Manager (encrypted at rest)

**vs API-based approach**:
- ✅ 5-10x faster token generation
- ✅ Lower cost (no API charges)
- ✅ Better scalability (no API throttling)
- ❌ More complex key management

## Resources

- [AWS IVS RealTime Documentation](https://docs.aws.amazon.com/ivs/latest/RealTimeUserGuide/)
- [AWS WAF Documentation](https://docs.aws.amazon.com/waf/)
- [JWT.io - JSON Web Tokens](https://jwt.io/)
- [ES384 Algorithm (ECDSA with P-384 and SHA-384)](https://datatracker.ietf.org/doc/html/rfc7518#section-3.4)

## Support

For issues or questions:
1. Check CloudWatch logs for errors
2. Review WAF metrics for blocked requests
3. Verify CloudFormation stack outputs
4. Test API endpoint with curl commands above
5. Verify private key format (PEM with ES384)
