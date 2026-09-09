npm init -y
npm install \
  @aws/aurora-dsql-node-postgres-connector \
  @aws-sdk/client-dynamodb \
  @aws-sdk/client-neptunedata \
  @aws-sdk/client-rds-data \
  @aws-sdk/client-redshift-data \
  @aws-sdk/client-secrets-manager \
  @aws-sdk/client-timestream-query \
  @aws-sdk/client-timestream-write \
  @aws-sdk/credential-providers \
  @aws-sdk/dsql-signer \
  @aws-sdk/lib-dynamodb \
  @aws-sdk/rds-signer \
  pg mysql2 mongodb cassandra-driver redis memcache-client

zip -r database-gadget.zip \
  database-index.mjs database-workbench.mjs local-logs.mjs package.json package-lock.json node_modules

aws secretsmanager create-secret \
  --name gadget/database-connections \
  --secret-string file://database-connections.json

aws lambda update-function-code \
  --function-name database-gadget \
  --zip-file fileb://database-gadget.zip

aws lambda wait function-updated --function-name database-gadget

aws lambda update-function-configuration \
  --function-name database-gadget \
  --handler database-index.handler \
  --timeout 30 \
  --memory-size 512 \
  --environment 'Variables={DB_CONNECTIONS_SECRET=gadget/database-connections,DB_WORKBENCH_USER=database,DB_WORKBENCH_PASSWORD=change-this-now}'

aws lambda create-function-url-config \
  --function-name database-gadget \
  --auth-type NONE \
  --invoke-mode BUFFERED

aws lambda add-permission \
  --function-name database-gadget \
  --statement-id DbUrlPolicyInvokeURL \
  --action lambda:InvokeFunctionUrl \
  --principal '*' \
  --function-url-auth-type NONE

aws lambda add-permission \
  --function-name database-gadget \
  --statement-id DbUrlPolicyInvokeFunction \
  --action lambda:InvokeFunction \
  --principal '*' \
  --invoked-via-function-url
