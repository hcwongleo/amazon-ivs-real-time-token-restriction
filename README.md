# Secure Token Generation for AWS IVS RealTime

A serverless solution for generating AWS IVS RealTime participant tokens using key-based JWT signing with AWS WAF security controls.

## Why This Solution?

**Performance**: 10-20ms token generation (vs 100-200ms with API calls)
**Cost**: No IVS API charges, only Lambda execution
**Security**: Geo-blocking and origin validation at the edge with AWS WAF
**Scalability**: No API rate limits, cryptographic signing is computed locally

## Architecture

```
User Browser (Singapore, localhost:3000)
         │
         ↓
    AWS WAF (Security Layer)
    ├─ Allow OPTIONS (CORS)
    ├─ Geo-blocking: HK, US, CA, GB, SG
    └─ Origin check: http://localhost:3000
         │
         ↓ (Both checks must pass)
    API Gateway (/prod/token)
         │
         ↓
    Lambda Function
    ├─ Fetch private key (Secrets Manager)
    ├─ Get stage info (IVS GetStage API)
    └─ Sign JWT with ES384
         │
         ↓
    Return Token → User joins IVS Stage
```

### Security Layers

1. **WAF**: Blocks unauthorized countries/origins before reaching Lambda
2. **Secrets Manager**: Encrypted private key storage with IAM access control
3. **JWT Signing**: ES384 cryptographic signatures for token authenticity
4. **CORS**: Origin validation in both WAF and Lambda responses

## Quick Start

### Prerequisites

- AWS account with permissions for Lambda, API Gateway, WAF, Secrets Manager
- IVS RealTime stage
- Node.js 20.x

### 1. Generate ES384 Key Pair

```bash
# Generate private key
openssl ecparam -genkey -name secp384r1 -noout -out private-key.pem

# Extract public key
openssl ec -in private-key.pem -pubout -out public-key.pem
```

### 2. Import Public Key to IVS

```bash
aws ivs import-public-key \
  --public-key-material file://public-key.pem \
  --region us-east-1
```

Save the returned ARN (e.g., `arn:aws:ivs:us-east-1:123456789012:public-key/AbCdEfGh`).

### 3. Prepare Lambda Package

```bash
cd get-token-key/lambda
npm install --production
zip -r function.zip tokenGenerator.js package.json node_modules/
```

### 4. Deploy CloudFormation Stack

1. Open AWS Console → CloudFormation → Create Stack
2. Upload `get-token-key/infrastructure/template.yaml`
3. Configure parameters:
   - **Stack name**: `ivs-token-generator-key`
   - **StageArn**: Your IVS Stage ARN
   - **PublicKeyArn**: ARN from step 2
   - **PrivateKey**: Paste entire `private-key.pem` content
   - **AllowedOrigins**: `http://localhost:3000`
   - **AllowedCountries**: `HK,US,CA,GB,SG`
4. Acknowledge IAM resource creation
5. Submit (takes ~2-3 minutes)

### 5. Upload Lambda Code

1. Go to Lambda Console → `IVSTokenGeneratorKey`
2. Upload from → .zip file → Select `function.zip`
3. Save

### 6. Get API Endpoint

CloudFormation → Stack → Outputs tab → Copy `ApiEndpoint`

### 7. Update Player

Edit `player/player.js` line 27:

```javascript
const API_ENDPOINT = 'https://xxxxxxxxxx.execute-api.us-east-1.amazonaws.com/prod/token';
```

### 8. Test

```bash
curl -X POST https://your-api-endpoint.com/prod/token \
  -H "Origin: http://localhost:3000" \
  -H "Content-Type: application/json"
```

Expected response:
```json
{
  "token": "eyJhbGciOiJFUzM4NCIsInR5cCI6IkpXVCJ9..."
}
```

## Key Features

| Feature | This Solution | API-Based |
|---------|--------------|-----------|
| Token generation | ~10-20ms | ~100-200ms |
| Cost per 1M tokens | ~$0.20 | ~$0.20 + $10-20 API |
| IVS API calls | 1 (GetStage, cached) | 1 per token |
| Scalability | No rate limits | API throttling |

## Configuration

### Add More Countries

Update CloudFormation parameter `AllowedCountries`:
```
HK,US,CA,GB,SG,JP,KR,AU,NZ
```

### Add More Origins

Update CloudFormation parameter `AllowedOrigins`:
```
http://localhost:3000,http://localhost:8000,https://yourdomain.com
```

### Change Token Expiration

Edit `get-token-key/lambda/tokenGenerator.js` line 105:

```javascript
exp: now + 5,  // 5 seconds (current)
// Change to:
exp: now + (30 * 60),  // 30 minutes
exp: now + (60 * 60),  // 1 hour
```

Redeploy Lambda after changes.

## Monitoring

- **Lambda logs**: CloudWatch → `/aws/lambda/IVSTokenGeneratorKey`
- **WAF metrics**: WAF Console → Web ACLs → `IVSTokenAPIKeyWebACL`
- **API Gateway**: CloudWatch → API Gateway metrics

## Troubleshooting

| Issue | Solution |
|-------|----------|
| 403 Forbidden | Check origin header and country in allowed lists |
| 500 Error | Check Lambda CloudWatch logs |
| Invalid signature | Verify ES384 key format |
| Token expired | Token TTL is 5 seconds by default, regenerate or increase |

## Cost Estimate (100K tokens/month)

- Lambda: ~$0.02
- API Gateway: ~$0.35
- WAF: ~$5.10
- Secrets Manager: ~$0.41
- CloudWatch: ~$0.10

**Total: ~$6/month** (vs ~$16-26 with API-based approach)

## Clean Up

CloudFormation Console → Select stack → Delete

This removes all resources: Lambda, API Gateway, WAF, Secrets Manager, IAM roles, CloudWatch logs.

## Resources

- **Full Blog Post**: See `BLOG_POST.md` for detailed explanation with architecture diagrams
- [AWS IVS RealTime Documentation](https://docs.aws.amazon.com/ivs/latest/RealTimeUserGuide/)
- [ES384 Algorithm Specification](https://datatracker.ietf.org/doc/html/rfc7518#section-3.4)
- [AWS WAF Documentation](https://docs.aws.amazon.com/waf/)

## Project Structure

```
├── get-token-key/
│   ├── infrastructure/
│   │   └── template.yaml          # CloudFormation template
│   ├── lambda/
│   │   ├── tokenGenerator.js      # Lambda function code
│   │   └── package.json           # Node.js dependencies
│   └── private-key-public-key.pem # Your ES384 keys
├── player/
│   ├── player.html                # Test player
│   └── player.js                  # Player logic with API integration
├── BLOG_POST.md                   # Detailed blog post
└── README.md                      # This file
```

## License

This project is licensed under Apache-2.0.
