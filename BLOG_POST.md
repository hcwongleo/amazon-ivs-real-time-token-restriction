# Securing Token Generation for Amazon IVS Real-Time Streaming with AWS WAF and TTL Controls

by Leo Wong, Kerry Gao | on 3 Feb 2026 | in Amazon API Gateway, Amazon IVS, AWS Lambda, AWS Secrets Manager, AWS WAF, Media & Entertainment, Media Services, Security, Identity, & Compliance

Amazon Interactive Video Service (IVS) Real-Time Streaming gives you everything you need to add real-time audio and video to your applications. It supports use cases like virtual events, live auctions, and collaborative applications where multiple hosts and thousands of viewers need to interact in real time. Access to IVS Real-Time stages is controlled through participant tokens—short-lived JWTs that determine who can join and what capabilities they have (publish, subscribe, or both).

While token generation is essential for stage access, securing the token endpoint itself is equally critical. Without proper controls, anyone could request tokens and potentially join your stages without authorization. This post shows you how to implement a secure token generation system using key-based JWT signing with AWS WAF protection and defense-in-depth security controls.

## Solution overview

Figure 1 shows the architecture for this solution.

![Figure 1: Architecture diagram showing the request flow from browser → WAF → API Gateway → Lambda → Secrets Manager, with IVS Stage connected separately](images/architecture-diagram.png)

When a user requests a token, the request flows through the following steps:

1. **Request Token** - The browser sends a POST request with the origin header to AWS WAF.

2. **Validate Rules (Country and Origin Check)** - AWS WAF checks that both the country code and origin match configured values, blocking unauthorized requests without consuming Lambda resources.

3. **Forward Request** - Valid requests are forwarded to API Gateway.

4. **Invoke** - API Gateway invokes the token generator Lambda function.

5. **Retrieve Key** - Lambda fetches the private signing key from Secrets Manager (secured with encryption and IAM access controls).

6. **Sign JWT** - Lambda retrieves stage information from IVS API and creates a signed JWT token with customizable expiration time (TTL)—from seconds for testing to hours for extended sessions.

7. **Return Token** - API Gateway returns the signed token to the user's browser with CORS headers.

8. **Join with Token** - The user connects to the IVS Real-time Stage using the token, where Amazon IVS validates the signature using the registered public key before granting access.

## Prerequisites

Before you begin, ensure you have the following:

- An [AWS account](https://aws.amazon.com/free/)
- An IAM user with sufficient permissions to deploy Lambda, API Gateway, Secrets Manager, WAF, and CloudFormation resources
- An existing Amazon IVS Real-Time Streaming stage. For more information, refer to [Creating a stage](https://docs.aws.amazon.com/ivs/latest/RealTimeUserGuide/getting-started-create-stage.html)
- [Node.js](https://nodejs.org/) 20.x or later installed locally for packaging the Lambda function

## Walkthrough

In this section, we walk you through the steps to deploy the secure token generation system. The walkthrough follows these high-level steps:

1. Set up key pair (generate and import to IVS)
2. Prepare the Lambda deployment package
3. Deploy the CloudFormation stack
4. Set the private key in Secrets Manager
5. Upload the Lambda function code
6. Get your API endpoint
7. Configure and run the player locally
8. Test token generation with the player
9. Verify security controls

Complete the steps in the following sections.

### Step 1: Set up key pair

To enable secure token signing, you need a public/private key pair. The private key will be stored in AWS Secrets Manager for Lambda to sign tokens, while the public key is registered with Amazon IVS to verify token authenticity when participants join your stage. You have two options for creating the key pair:

**Option A: Create with the Console (Recommended)**

The simplest approach is to create the key pair through the Amazon IVS console:

1. Open the [Amazon IVS console](https://console.aws.amazon.com/ivs/) and choose your stage's region
2. In the left navigation menu, choose **Real-time streaming > Public keys**
3. Choose **Create public key**
4. Follow the prompts and choose **Create**

![PLACEHOLDER: Screenshot of the IVS console showing the Create public key button](images/create-public-key.png)

Amazon IVS generates a new key pair. The public key is imported as a public key resource and the private key is immediately made available for download.

**Important:** Amazon IVS generates the key on the client side and does not store the private key. Be sure you save the key; you cannot retrieve it later.

Save the entire response:
- The public key **ARN** will be used in CloudFormation's `PublicKeyArn` parameter (Step 3)
- The **private key** content will be stored in Secrets Manager (Step 4)

**Option B: Create with OpenSSL and Import**

Alternatively, you can generate a key pair locally using OpenSSL and import the public key to Amazon IVS Real-Time Streaming using the AWS CLI `ivs-realtime import-public-key` command. This approach gives you full control over key generation.

Save the ARN from the import response for CloudFormation deployment (Step 3) and keep your private key secure for Secrets Manager setup (Step 4).

For more information, refer to [Distribute Participant Tokens](https://docs.aws.amazon.com/ivs/latest/RealTimeUserGuide/getting-started-distribute-tokens.html).

### Step 2: Prepare the Lambda deployment package

Navigate to your project's lambda directory and install dependencies:

```bash
cd lambda
npm install --production
```

Create a deployment package:

```bash
zip -r function.zip tokenGenerator.js package.json node_modules/
```

The `function.zip` file is now ready for upload to Lambda.

### Step 3: Deploy the CloudFormation stack

Navigate to the [AWS CloudFormation console](https://console.aws.amazon.com/cloudformation/) and choose **Create stack**.

Choose **Upload a template file**, select the `infrastructure/template.yaml` file from your project, and choose **Next**.

Configure the stack parameters:

- **Stack name**: `ivs-token-generator-key`
- **StageArn**: Your IVS Stage ARN (e.g., `arn:aws:ivs:us-east-1:123456789012:stage/AbCdEfGhIjKl`)
- **PublicKeyArn**: The ARN from Step 1 (e.g., `arn:aws:ivs:us-east-1:123456789012:playback-key/AbCdEfGhIjKl`)
- **AllowedOrigins**: `http://localhost:3000` (or your application's origin)
- **AllowedCountry**: `HK` (ISO country code)

Choose **Next**, then **Next** again. On the review page, check **I acknowledge that AWS CloudFormation might create IAM resources**, then choose **Submit**.

The stack deployment takes approximately 2-3 minutes. Wait for the status to change to `CREATE_COMPLETE`.

### Step 4: Set private key in Secrets Manager

After the CloudFormation stack is created, you need to manually populate the private key in AWS Secrets Manager:

1. Navigate to the [AWS Secrets Manager console](https://console.aws.amazon.com/secretsmanager/)
2. Find and select the secret named `ivs-realtime-private-key`
3. Choose **Retrieve secret value**, then choose **Edit**
4. Replace the placeholder text with your private key from Step 1:
   - If you created the key via IVS Console: Paste the entire `privateKeyMaterial` content
   - If you used OpenSSL: Paste the entire contents of your `priv.pem` file
   - Ensure you include the `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----` markers
5. Choose **Save**

The Lambda function will now be able to retrieve and use this private key to sign tokens.

### Step 5: Upload Lambda function code

The CloudFormation stack creates the Lambda function with placeholder code. Now upload your actual implementation:

1. Navigate to the [AWS Lambda console](https://console.aws.amazon.com/lambda/) and choose the `IVSTokenGeneratorKey` function
2. Choose **Upload from** → **.zip file**
3. Select the `function.zip` file you created in Step 2
4. Choose **Save**

Verify the environment variables are correctly set:

- Navigate to **Configuration** → **Environment variables**
- Confirm `STAGE_ARN`, `PUBLIC_KEY_ARN`, and `SECRET_NAME` are present

### Step 6: Get your API endpoint

Return to the [AWS CloudFormation console](https://console.aws.amazon.com/cloudformation/), select your stack, and choose the **Outputs** tab. Copy the **ApiEndpoint** value.

### Step 7: Configure and run the player

Update the API endpoint in your player code. Open `player/player.js` and replace line 27 with your API endpoint from Step 6:

```javascript
const API_ENDPOINT = 'https://xxxxxxxxxx.execute-api.us-east-1.amazonaws.com/prod/token';
```

Start a local web server to serve the player. Navigate to the player directory and run:

```bash
cd player
npx http-server -p 3000
```

This uses [http-server](https://www.npmjs.com/package/http-server), a simple Node.js web server that npx will download and run to serve the player on port 3000.

Open your browser and navigate to `http://localhost:3000/player.html`

![PLACEHOLDER: Screenshot of player interface in browser](images/player-interface.png)

### Step 8: Test token generation with the player

Click the **Join Stage** button in the player interface. The player will:

1. Automatically fetch a token from your API Gateway endpoint
2. Include the Origin header (`http://localhost:3000`) in the request
3. Submit the request from your current geographic location
4. AWS WAF validates both the origin and country
5. If validation passes, the token is returned and used to join the Amazon IVS Real-Time Streaming stage

Open your browser's developer console (F12) to view the token fetch request and response. A successful token generation will show:

```json
{
  "token": "YOUR_JWT_TOKEN_HERE..."
}
```

### Step 9: Verify security controls

Test that WAF correctly blocks unauthorized token generation requests using the player.

**Test 1: Geo-blocking**

1. Connect to a VPN server in a country different from your configured allowed country
2. Refresh the player page at `http://localhost:3000/player.html`
3. Click **Join Stage**
4. Expected result: Request blocked with 403 Forbidden error in browser console

**Test 2: Origin validation**

1. Temporarily [update your CloudFormation stack](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-updating-stacks.html) to change `AllowedOrigins` to a different value (e.g., `http://localhost:8000`)
2. Wait for the stack update to complete
3. Try to join the stage again from `http://localhost:3000`
4. Expected result: Request blocked with 403 Forbidden error in browser console
5. Revert the CloudFormation parameter back to `http://localhost:3000`

**Test 3: View WAF metrics**

1. Navigate to the [AWS WAF console](https://console.aws.amazon.com/wafv2/)
2. Choose **Web ACLs** → `IVSTokenAPIKeyWebACL`
3. Choose the **Metrics** tab to view allowed and blocked requests
4. You should see metrics for successful token requests and any blocked attempts

![PLACEHOLDER: Screenshot of WAF Web ACL metrics dashboard showing allowed and blocked requests](images/web-acl.png)

## Clean up resources

To avoid incurring future charges, delete the CloudFormation stack:

1. Navigate to the [AWS CloudFormation console](https://console.aws.amazon.com/cloudformation/)
2. Select the `ivs-token-generator-key` stack
3. Choose **Delete**
4. Choose **Delete stack** to confirm

This removes all created resources including Lambda, API Gateway, WAF, Secrets Manager secret, and IAM roles.

## Conclusion

This solution demonstrates how to secure token generation for Amazon IVS Real-Time Streaming using a defense-in-depth approach. By combining AWS WAF request filtering, customizable TTL controls, and key-based JWT signing, you gain precise control over who can obtain tokens and when they expire—making it suitable for production deployments where secure access control is essential.

For the complete code and deployment templates, visit the [GitHub repository](https://github.com/hcwongleo/amazon-ivs-real-time-token-restriction.git).

## Further resources

- [Amazon IVS Real-Time Streaming User Guide](https://docs.aws.amazon.com/ivs/latest/RealTimeUserGuide/)
- [Distribute Participant Tokens](https://docs.aws.amazon.com/ivs/latest/RealTimeUserGuide/getting-started-distribute-tokens.html)
- [AWS WAF Developer Guide](https://docs.aws.amazon.com/waf/latest/developerguide/)