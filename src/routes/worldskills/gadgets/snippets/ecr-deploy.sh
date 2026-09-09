zip ecr-gadget.zip ecr-index.mjs ecr-manager.mjs local-logs.mjs

aws codebuild create-project \
  --cli-input-json file://ecr-codebuild-project.json

aws lambda update-function-code \
  --function-name ecr-gadget \
  --zip-file fileb://ecr-gadget.zip

aws lambda wait function-updated --function-name ecr-gadget

aws lambda update-function-configuration \
  --function-name ecr-gadget \
  --handler ecr-index.handler \
  --timeout 30 \
  --memory-size 512 \
  --environment 'Variables={ECR_CODEBUILD_PROJECT=ecr-image-builder,ECR_MANAGER_USER=ecr,ECR_MANAGER_PASSWORD=change-this-now}'

aws lambda create-function-url-config \
  --function-name ecr-gadget \
  --auth-type NONE \
  --invoke-mode BUFFERED

aws lambda add-permission \
  --function-name ecr-gadget \
  --statement-id EcrUrlPolicyInvokeURL \
  --action lambda:InvokeFunctionUrl \
  --principal '*' \
  --function-url-auth-type NONE

aws lambda add-permission \
  --function-name ecr-gadget \
  --statement-id EcrUrlPolicyInvokeFunction \
  --action lambda:InvokeFunction \
  --principal '*' \
  --invoked-via-function-url
