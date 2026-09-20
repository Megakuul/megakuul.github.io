# After extracting the function ZIP into db-demo, edit the variables in the
# examples you want: redshift.mjs, athena.mjs, opensearch.mjs, opensearch-serverless.mjs.
(cd db-demo && zip -qr ../db-demo.zip .)
aws lambda update-function-code --function-name db-demo --zip-file fileb://db-demo.zip
aws lambda wait function-updated-v2 --function-name db-demo
aws lambda update-function-configuration --function-name db-demo --timeout 60
aws lambda wait function-updated-v2 --function-name db-demo
aws lambda invoke --function-name db-demo --cli-binary-format raw-in-base64-out --payload '{"database":"redshift","minAmount":2}' redshift.json
aws lambda invoke --function-name db-demo --cli-binary-format raw-in-base64-out --payload '{"database":"athena","minAmount":2}' athena.json
aws lambda invoke --function-name db-demo --cli-binary-format raw-in-base64-out --payload '{"database":"opensearch"}' opensearch.json
aws lambda invoke --function-name db-demo --cli-binary-format raw-in-base64-out --payload '{"database":"opensearch-serverless","search":"apple"}' opensearch-serverless.json
