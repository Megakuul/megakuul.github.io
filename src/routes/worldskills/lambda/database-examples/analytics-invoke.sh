curl -fLO https://megakuul.ch/downloads/nodejs-databases-function.zip
aws lambda update-function-code --function-name db-demo --zip-file fileb://nodejs-databases-function.zip
aws lambda wait function-updated-v2 --function-name db-demo
aws lambda get-function-configuration --function-name db-demo > function-current.json
jq --slurpfile config analytics-environment.json '{FunctionName,RevisionId,Timeout:60,Environment:{Variables:((.Environment.Variables // {}) + $config[0].Variables)}}' function-current.json > function-analytics.json
aws lambda update-function-configuration --cli-input-json file://function-analytics.json
aws lambda wait function-updated-v2 --function-name db-demo
aws lambda invoke --function-name db-demo --cli-binary-format raw-in-base64-out --payload '{"database":"redshift","minAmount":2}' redshift.json
aws lambda invoke --function-name db-demo --cli-binary-format raw-in-base64-out --payload '{"database":"athena","minAmount":2}' athena.json
aws lambda invoke --function-name db-demo --cli-binary-format raw-in-base64-out --payload '{"database":"opensearch"}' opensearch.json
aws lambda invoke --function-name db-demo --cli-binary-format raw-in-base64-out --payload '{"database":"opensearch-serverless","search":"apple"}' opensearch-serverless.json
