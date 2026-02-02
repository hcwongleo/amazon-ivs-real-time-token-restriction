const { IVSRealTimeClient, CreateParticipantTokenCommand } = require("@aws-sdk/client-ivs-realtime");

const ivsRealtimeClient = new IVSRealTimeClient({ region: process.env.AWS_REGION });
const stageArn = process.env.STAGE_ARN;

exports.handler = async (event) => {
  try {
    const createStageTokenRequest = new CreateParticipantTokenCommand({
      stageArn,
      duration: 1, // duration in Duration (in minutes), after which the token expires. Default: 720 (12 hours). must be in integer
    });
    
    const response = await ivsRealtimeClient.send(createStageTokenRequest);
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': event.headers?.origin || '*'
      },
      body: JSON.stringify({
        token: response.participantToken.token
      })
    };
  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ error: 'Failed to generate token' })
    };
  }
};
