jq -n --arg resource "$CONFIG_ARN" '{Version:"2012-10-17",Statement:[{Effect:"Allow",Action:["appconfig:StartConfigurationSession","appconfig:GetLatestConfiguration"],Resource:$resource}]}' > appconfig-read.json

# Optional: only when the deployed configuration uses this customer-managed KMS key
KMS_KEY_ARN=''
if [ -n "$KMS_KEY_ARN" ]; then
  jq --arg key "$KMS_KEY_ARN" '.Statement += [{Effect:"Allow",Action:"kms:Decrypt",Resource:$key}]' appconfig-read.json > appconfig-read-kms.json
  mv appconfig-read-kms.json appconfig-read.json
fi

POLICY_ARN=$(aws iam create-policy --policy-name "AppConfigRead-$APP_ID-$ENV_ID-$PROFILE_ID" --policy-document file://appconfig-read.json --query Policy.Arn --output text)
