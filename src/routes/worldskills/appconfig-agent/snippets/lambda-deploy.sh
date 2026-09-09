FUNCTION=my-function
aws lambda get-function-configuration --function-name "$FUNCTION" > lambda-current.json
ROLE_ARN=$(jq -r .Role lambda-current.json)
aws iam attach-role-policy --role-name "${ROLE_ARN##*/}" --policy-arn "$POLICY_ARN"
ARCH=$(jq -r '.Architectures[0] // "x86_64"' lambda-current.json)
[ "$ARCH" != x86_64 ] || ARCH=x86
LAYER_ARN=$(aws ssm get-parameter --name "/aws/service/aws-appconfig/lambda-extension/$ARCH/latest" --query Parameter.Value --output text)

jq --arg layer "$LAYER_ARN" --arg path "$CONFIG_PATH" --arg region "$AWS_REGION" '{
  FunctionName, RevisionId,
  Layers: ([.Layers[]?.Arn | select(test(":layer:AWS-AppConfig-Extension(-Arm64)?:") | not)] + [$layer]),
  Environment: {Variables: ((.Environment.Variables // {}) + {
    APPCONFIG_PATH: $path,
    AWS_APPCONFIG_EXTENSION_SERVICE_REGION: $region,
    AWS_APPCONFIG_EXTENSION_HTTP_PORT: "2772",
    AWS_APPCONFIG_EXTENSION_PREFETCH_LIST: $path,
    AWS_APPCONFIG_EXTENSION_POLL_INTERVAL_SECONDS: "45",
    AWS_APPCONFIG_EXTENSION_POLL_TIMEOUT_MILLIS: "3000",
    AWS_APPCONFIG_EXTENSION_LOG_LEVEL: "warn"
  })}
}' lambda-current.json > lambda-agent.json
aws lambda update-function-configuration --cli-input-json file://lambda-agent.json
aws lambda wait function-updated-v2 --function-name "$FUNCTION"
