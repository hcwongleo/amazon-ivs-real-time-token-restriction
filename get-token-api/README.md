# IVS RealTime Token Generator with Geo-blocking

This project implements a secure token generation system for AWS IVS RealTime with geo-blocking and origin checking at the API Gateway level using AWS WAF.

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
│                      IVSTokenGenerator                              │
├─────────────────────────────────────────────────────────────────────┤
│  const ivsClient = new IVSRealTimeClient();                         │
│  const command = new CreateParticipantTokenCommand({                │
│    stageArn: "arn:aws:ivs:us-east-1:xxx:stage/xxx",                │
│    duration: 5  // Token expires in 5 seconds                       │
│  });                                                                │
│  const response = await ivsClient.send(command);                    │
│  return { token: response.participantToken.token };                 │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 │ 4. Call IVS API
                                 │    CreateParticipantToken
                                 ↓
┌─────────────────────────────────────────────────────────────────────┐
│                    AWS IVS RealTime Service                         │
│                  Stage: Lem70VypWv33 (us-east-1)                   │
├─────────────────────────────────────────────────────────────────────┤
│  • Validates stage ARN                                              │
│  • Generates JWT token with:                                        │
│    - Stage ARN                                                      │
│    - Participant capabilities (subscribe)                           │
│    - Expiration time (5 seconds)                                    │
│  • Returns signed token                                             │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 │ 5. Return Token
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
                                 │ 6. Return to Browser
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
- ✅ Only generates IVS tokens
- ✅ Minimal code = faster execution

**4. IAM Permissions**
- ✅ Lambda has permission to call `ivs:CreateParticipantToken`
- ✅ Scoped to specific Stage ARN only

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

API Gateway → Lambda → IVS → Return Token ✅
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

### Why API Gateway Level Security?

| Aspect | API Gateway + WAF | Lambda-only |
|--------|------------------|-------------|
| **Performance** | ⚡ Blocks at edge | 🐌 Invokes Lambda first |
| **Cost** | 💰 No Lambda cost for blocked requests | 💸 Pay for every request |
| **Security** | 🛡️ Defense in depth | 🔓 Single layer |
| **Monitoring** | 📊 WAF metrics + Lambda logs | 📊 Lambda logs only |
| **Scalability** | 🚀 WAF handles millions of requests | 🐌 Lambda concurrency limits |
| **Best Practice** | ✅ Industry standard | ❌ Not recommended |

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
│   └── Environment: STAGE_ARN
└── IAM Role (AWS::IAM::Role)
    └── Policy: ivs:CreateParticipantToken

lambda/tokenGenerator.js
└── Simple token generation (no validation)

Player/player.js
└── Fetches token from API automatically
```

## Features

- **Origin Validation**: Only allows requests from specified domains (enforced by WAF)
- **Geo-blocking**: Restricts access based on country codes (enforced by WAF)
- **Secure Token Generation**: Creates IVS participant tokens server-side
- **CORS Support**: Proper CORS headers for browser requests

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

### Step 2: Deploy CloudFormation Stack

1. **Open AWS Console** → CloudFormation → Create Stack

2. **Upload Template**:
   - Choose "Upload a template file"
   - Select `infrastructure/template.yaml`
   - Click "Next"

3. **Configure Stack Parameters**:
   - **Stack name**: `ivs-token-generator`
   - **StageArn**: `arn:aws:ivs:us-east-1:385085470441:stage/Lem70VypWv33`
   - **AllowedOrigins**: `https://yourapp.com,http://localhost:3000,http://localhost:8000,http://127.0.0.1:3000`
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

### Step 3: Upload Lambda Function Code

1. **Go to Lambda Console** → Functions → `IVSTokenGenerator`

2. **Upload Code**:
   - Click "Upload from" → ".zip file"
   - Select the `function.zip` you created in Step 1
   - Click "Save"

3. **Verify Environment Variables**:
   - Go to "Configuration" → "Environment variables"
   - Confirm these are set:
     - `STAGE_ARN`: Your IVS Stage ARN
     - `AWS_REGION`: us-east-1

### Step 4: Get API Endpoint

1. **Go to CloudFormation** → Stacks → `ivs-token-generator`

2. **Click "Outputs" tab**

3. **Copy the API Endpoint URL**:
   - Key: `ApiEndpoint`
   - Value: `https://xxxxxxxxxx.execute-api.us-east-1.amazonaws.com/prod/token`

### Step 5: Update Player Configuration

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

### Step 6: Test the Deployment

#### Test API Directly:
```bash
curl -X POST https://xxxxxxxxxx.execute-api.us-east-1.amazonaws.com/prod/token \
  -H "Origin: http://localhost:3000" \
  -H "Content-Type: application/json"
```

Expected response:
```json
{
  "token": "eyJhbGciOiJLTVMiLCJ0eXAiOiJKV1QifQ..."
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

1. **Geo-blocking Rule (Priority 1)**
   - Checks request country code
   - Only allows: HK, US, CA, GB, SG
   - Blocks all other countries
   - Request never reaches Lambda if blocked

2. **Origin Validation Rule (Priority 2)**
   - Checks Origin header
   - Only allows configured origins
   - Blocks unauthorized domains
   - Request never reaches Lambda if blocked

3. **CORS Preflight Rule (Priority 3)**
   - Allows OPTIONS method
   - Enables browser CORS requests

## Changes Made to Player.js

### Added Features:
1. **`fetchTokenFromAPI()` function** (lines 35-60)
   - Fetches tokens from API Gateway
   - Includes error handling
   - Sends Origin header for validation

2. **Flexible token handling** (lines 95-105)
   - Supports manual token input (original behavior)
   - Supports automatic API fetching (new feature)
   - Easy to switch between modes

### To Enable API Mode:
Uncomment these lines in `Player/player.js`:
```javascript
if (!token) {
  token = await fetchTokenFromAPI();
}
```

## Monitoring

### CloudWatch Metrics:
1. **WAF Metrics**:
   - AWS Console → WAF & Shield → Web ACLs → `IVSTokenAPIWebACL`
   - View blocked/allowed requests by rule
   - See geo-blocking statistics

2. **Lambda Logs**:
   - AWS Console → CloudWatch → Log groups → `/aws/lambda/IVSTokenGenerator`
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
https://yourapp.com,https://www.yourapp.com,http://localhost:3000
```

**Note**: You need to update the CloudFormation stack to apply changes.

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| 403 Forbidden | Wrong origin or blocked country | Check WAF rules and your location |
| 500 Internal Error | Lambda error | Check CloudWatch logs for Lambda |
| CORS Error | Origin not in allowed list | Add origin to AllowedOrigins parameter |
| Token expired | Token older than 5 seconds | Generate new token |
| No response | API Gateway issue | Check API Gateway logs |

## Cost Estimate

- **Lambda**: ~$0.20 per 1M requests
- **API Gateway**: ~$3.50 per 1M requests
- **WAF**: ~$5/month + $1 per 1M requests
- **CloudWatch Logs**: ~$0.50/GB

**Typical monthly cost for 100K requests**: ~$5-10

## Cleanup

To remove all resources:

1. Go to CloudFormation Console
2. Select `ivs-token-generator` stack
3. Click "Delete"
4. Confirm deletion

This will remove:
- Lambda function
- API Gateway
- WAF Web ACL
- IAM roles
- CloudWatch log groups

## Architecture Details

### Why API Gateway Level Security?

**Benefits**:
- ✅ Blocked requests never reach Lambda (no compute cost)
- ✅ Protection happens before application code
- ✅ Better scalability - WAF handles high traffic
- ✅ Detailed metrics and monitoring
- ✅ Industry best practice for API security

**vs Lambda-level validation**:
- ❌ Every request invokes Lambda (higher cost)
- ❌ Security logic in application code
- ❌ Harder to monitor and audit
- ❌ More attack surface

## Resources

- [AWS IVS RealTime Documentation](https://docs.aws.amazon.com/ivs/latest/RealTimeUserGuide/)
- [AWS WAF Documentation](https://docs.aws.amazon.com/waf/)
- [API Gateway Security Best Practices](https://docs.aws.amazon.com/apigateway/latest/developerguide/security-best-practices.html)

## Support

For issues or questions:
1. Check CloudWatch logs for errors
2. Review WAF metrics for blocked requests
3. Verify CloudFormation stack outputs
4. Test API endpoint with curl commands above
